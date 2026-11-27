// Signal reading and Dismiss for the current viewer (step 13, spec §14.9). Storage and Jira visibility are
// mocked; tests/integration/clustering.test.ts runs the same code with the pass, panel and MCP end to end.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClusterRecord } from '../../domain/cluster';

const h = vi.hoisted(() => ({
  records: {} as Record<string, ClusterRecord[]>,
  listFails: false,
  visible: new Set<string>(),
  visibilityFails: false,
  checks: [] as string[][],
  put: vi.fn(),
  lockHeld: false,
}));

vi.mock('../../adapters/storage', () => ({
  listClusterRecords: async (projectKey: string) => {
    if (h.listFails) throw new Error('kvs-unavailable');
    return structuredClone(h.records[projectKey] ?? []);
  },
  putClusterRecord: h.put,
  acquireLock: async (key: string) => (h.lockHeld ? undefined : { key }),
  releaseLock: async () => true,
}));
vi.mock('../../adapters/jira', () => ({
  visibleIssueKeys: async (keys: string[]) => {
    h.checks.push(keys);
    if (h.visibilityFails) throw new Error('jira-visibility-503');
    return new Set(keys.filter((k) => h.visible.has(k)));
  },
}));

import { CLUSTER_CHECK_FAILED, CLUSTER_RECORDS_UNAVAILABLE, dismissSignal, signalsForProjects, signalsForTicket } from '../signals';

const rec = (signalId: string, keys: string[], over: Partial<ClusterRecord> = {}): ClusterRecord => ({
  storageKey: `cluster:ITS:${signalId}`,
  signalId,
  projectKey: 'ITS',
  identityType: 'uncertain-service-only',
  state: 'uncertain',
  reason: 'missing-entity-identity',
  serviceId: 'svc',
  windowStart: '2026-11-23T10:00:00.000Z',
  windowEnd: '2026-11-23T11:30:00.000Z',
  threshold: 2,
  raisedAt: '2026-11-23T10:05:00.000Z',
  lastUpdatedAt: '2026-11-23T10:05:00.000Z',
  lifecycle: 'raised',
  requestKeys: keys,
  evidence: keys.map((k) => ({ evidenceId: `${k}#service`, ticketKey: k, matchedOn: 'serviceAssociation:svc' })),
  ...over,
});

// Read time hides signals whose window has ended, so the clock is pinned inside the fixtures' window.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T10:30:00.000Z'));
});
afterEach(() => vi.useRealTimers());

beforeEach(() => {
  h.records = {};
  h.listFails = false;
  h.lockHeld = false;
  h.visible = new Set(['ITS-1', 'ITS-2', 'ITS-3']);
  h.visibilityFails = false;
  h.checks = [];
  h.put.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('signalsForTicket', () => {
  it('returns only active signals that include the ticket, checked in one visibility search, newest first', async () => {
    h.records.ITS = [
      rec('old', ['ITS-1', 'ITS-2'], { raisedAt: '2026-11-23T10:01:00.000Z' }),
      rec('new', ['ITS-1', 'ITS-3'], { raisedAt: '2026-11-23T10:09:00.000Z' }),
      rec('same', ['ITS-1', 'ITS-2'], { raisedAt: '2026-11-23T10:09:00.000Z' }),
      rec('other', ['ITS-2', 'ITS-3']),
      rec('dismissed', ['ITS-1', 'ITS-2'], { lifecycle: 'resolved' }),
      rec('expired', ['ITS-1', 'ITS-2'], { lifecycle: 'expired' }),
    ];
    const { signals, failure } = await signalsForTicket('ITS-1');
    expect(signals.map((s) => s.signalId)).toEqual(['new', 'same', 'old']);
    expect(failure).toBeUndefined();
    expect(h.checks).toHaveLength(1);
    expect([...h.checks[0]].sort()).toEqual(['ITS-1', 'ITS-2', 'ITS-3']);
  });

  it('drops a signal the viewer cannot see enough of, and hidden requests from the ones it keeps', async () => {
    h.records.ITS = [rec('a', ['ITS-1', 'ITS-9']), rec('b', ['ITS-1', 'ITS-2', 'ITS-9'])];
    const { signals } = await signalsForTicket('ITS-1');
    expect(signals.map((s) => [s.signalId, s.requestKeys])).toEqual([['b', ['ITS-1', 'ITS-2']]]);
    expect(JSON.stringify(signals)).not.toContain('ITS-9');
  });

  it('makes no visibility call when no signal includes the ticket', async () => {
    h.records.ITS = [rec('other', ['ITS-2', 'ITS-3'])];
    expect(await signalsForTicket('ITS-1')).toEqual({ signals: [] });
    expect(h.checks).toEqual([]);
  });

  it('fails closed when the visibility check fails', async () => {
    h.records.ITS = [rec('a', ['ITS-1', 'ITS-2'])];
    h.visibilityFails = true;
    expect(await signalsForTicket('ITS-1')).toEqual({ signals: [], failure: CLUSTER_CHECK_FAILED });
  });

  it('reports records that cannot be listed as a failure, never as no signals', async () => {
    h.listFails = true;
    expect(await signalsForTicket('ITS-1')).toEqual({ signals: [], failure: CLUSTER_RECORDS_UNAVAILABLE });
  });
});

describe('signalsForProjects', () => {
  it('reads every listed project', async () => {
    h.records.ITS = [rec('its', ['ITS-1', 'ITS-2'])];
    h.records.HR = [rec('hr', ['HR-1', 'HR-2'], { projectKey: 'HR' })];
    h.visible = new Set(['ITS-1', 'ITS-2', 'HR-1', 'HR-2']);
    const { signals } = await signalsForProjects(['ITS', 'HR']);
    expect(signals.map((s) => s.signalId).sort()).toEqual(['hr', 'its']);
  });
});

describe('dismissSignal', () => {
  it('resolves a signal the viewer can see, from a ticket in it', async () => {
    h.records.ITS = [rec('a', ['ITS-1', 'ITS-2'])];
    const now = new Date('2026-11-23T10:20:00.000Z');
    expect(await dismissSignal('ITS-1', 'a', now)).toEqual({ ok: true });
    expect(h.put).toHaveBeenCalledWith(expect.objectContaining({ signalId: 'a', lifecycle: 'resolved', resolvedAt: now.toISOString() }));
  });

  it('refuses when the viewer cannot see the ticket, the signal is unknown or not visible enough, or a check fails', async () => {
    h.records.ITS = [rec('a', ['ITS-1', 'ITS-9']), rec('b', ['ITS-1', 'ITS-2'])];
    expect(await dismissSignal('ITS-8', 'b')).toEqual({ ok: false });
    expect(await dismissSignal('ITS-1', 'nope')).toEqual({ ok: false });
    expect(await dismissSignal('ITS-1', 'a')).toEqual({ ok: false });
    h.visibilityFails = true;
    expect(await dismissSignal('ITS-1', 'b')).toEqual({ ok: false });
    expect(h.put).not.toHaveBeenCalled();
  });

  it('refuses, writing nothing, while a clustering pass holds the project lock', async () => {
    h.records.ITS = [rec('b', ['ITS-1', 'ITS-2'])];
    h.lockHeld = true;
    expect(await dismissSignal('ITS-1', 'b', new Date(), 0)).toEqual({ ok: false });
    expect(h.put).not.toHaveBeenCalled();
  });

  it('reports a storage failure as not dismissed', async () => {
    h.records.ITS = [rec('b', ['ITS-1', 'ITS-2'])];
    h.put.mockRejectedValue(new Error('kvs down'));
    expect(await dismissSignal('ITS-1', 'b')).toEqual({ ok: false });
  });
});
