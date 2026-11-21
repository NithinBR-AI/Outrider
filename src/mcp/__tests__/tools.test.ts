// Unit tests for the get-ticket-context tool logic. Jira, storage and the queue are mocked;
// the real filter (domain/authorize.ts) is used. Integration coverage: tests/integration/mcp-authorization.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildStatus, ContextBundle } from '../../domain/types';

const h = vi.hoisted(() => ({
  visibleIssueKeys: vi.fn(),
  getBundle: vi.fn(),
  getStatus: vi.fn(),
  enqueueTicketBuild: vi.fn(),
}));
vi.mock('../../adapters/jira', () => ({ visibleIssueKeys: h.visibleIssueKeys }));
vi.mock('../../adapters/storage', () => ({ getBundle: h.getBundle, getStatus: h.getStatus }));
vi.mock('../../pipeline/enqueue', () => ({ enqueueTicketBuild: h.enqueueTicketBuild }));

import { CLAIMS_NOTE, getTicketContext, NOT_ACCESSIBLE_MESSAGE, PENDING_MESSAGE, toMcpBundle, UNSUPPORTED_CLAIM_NOTE } from '../tools';
import { AUTH_JIRA_CHECK_FAILED } from '../../domain/authorize';

const ref = (id: string) => ({ kind: 'jira-issue' as const, id, url: `https://x/browse/${id}`, title: id, updatedAt: 'u' });
const bundle: ContextBundle = {
  ticketKey: 'ITS-1',
  builtAt: 't',
  buildId: 'b1',
  ticketFingerprint: 'fp',
  incidents: [{ source: ref('ITO-1'), status: 'active', summary: 'restricted', relevance: 0.5 }],
  resolutions: [{ source: ref('ITS-2'), resolvedAt: 't', resolutionText: 'fix', matchReason: 'same-symptom', relevance: 0.4 }],
  articles: [],
  services: [],
  partial: false,
  failures: [],
};
const status = (s: BuildStatus['status'], buildId = 'b-flight'): BuildStatus => ({ ticketKey: 'ITS-1', buildId, requestedAt: '2026-11-21T04:00:00.000Z', status: s, actor: { source: 'jira-event' } });
const sees = (...keys: string[]) => async (asked: string[]) => new Set(asked.filter((k) => keys.includes(k)));

beforeEach(() => {
  h.visibleIssueKeys.mockReset();
  h.getBundle.mockReset().mockResolvedValue(undefined);
  h.getStatus.mockReset().mockResolvedValue(undefined);
  h.enqueueTicketBuild.mockReset().mockResolvedValue({ buildId: 'b-new', requestedAt: '2026-11-21T04:05:00.000Z' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('authorization gate', () => {
  it('ticket not visible: not-accessible, and nothing is read or queued', async () => {
    h.visibleIssueKeys.mockImplementation(sees());
    expect(await getTicketContext('ITS-1', 'caller')).toEqual({ status: 'not-accessible', ticketKey: 'ITS-1', message: NOT_ACCESSIBLE_MESSAGE });
    expect(h.getBundle).not.toHaveBeenCalled();
    expect(h.getStatus).not.toHaveBeenCalled();
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
  });

  it('ticket check fails: not-accessible (fails closed), nothing read or queued', async () => {
    h.visibleIssueKeys.mockRejectedValue(new Error('jira-visibility-503'));
    expect(await getTicketContext('ITS-1', 'caller')).toMatchObject({ status: 'not-accessible' });
    expect(h.getBundle).not.toHaveBeenCalled();
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
  });

  it('checks only the ticket in the first call', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
    await getTicketContext('ITS-1', 'caller');
    expect(h.visibleIssueKeys.mock.calls[0][0]).toEqual(['ITS-1']);
  });
});

describe('no bundle yet', () => {
  beforeEach(() => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
  });

  it.each(['queued', 'building'] as const)('build %s: returns pending for that build, queues nothing', async (s) => {
    h.getStatus.mockResolvedValue(status(s));
    expect(await getTicketContext('ITS-1', 'caller')).toEqual({ status: 'pending', ticketKey: 'ITS-1', buildId: 'b-flight', requestedAt: '2026-11-21T04:00:00.000Z', message: PENDING_MESSAGE });
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
  });

  it('no status: queues a build attributed to the caller and returns pending for it', async () => {
    expect(await getTicketContext('ITS-1', 'caller-1')).toEqual({ status: 'pending', ticketKey: 'ITS-1', buildId: 'b-new', requestedAt: '2026-11-21T04:05:00.000Z', message: PENDING_MESSAGE });
    expect(h.enqueueTicketBuild).toHaveBeenCalledWith('ITS-1', { accountId: 'caller-1', source: 'unknown' });
  });

  it.each(['failed', 'enqueue_failed', 'complete', 'superseded'] as const)('last build %s without a bundle: queues a fresh build', async (s) => {
    h.getStatus.mockResolvedValue(status(s));
    expect(await getTicketContext('ITS-1', 'caller')).toMatchObject({ status: 'pending', buildId: 'b-new' });
    expect(h.enqueueTicketBuild).toHaveBeenCalledTimes(1);
  });
});

describe('bundle exists', () => {
  beforeEach(() => {
    h.getBundle.mockResolvedValue(bundle);
  });

  it('returns it filtered for the caller', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1', 'ITS-2'));
    const r = (await getTicketContext('ITS-1', 'caller')) as ContextBundle;
    expect(r.incidents).toEqual([]);
    expect(r.resolutions.map((x) => x.source.id)).toEqual(['ITS-2']);
    expect(r.partial).toBe(false);
    expect(JSON.stringify(r)).not.toContain('restricted');
  });

  it('checks the sources in a second call, after the ticket', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1', 'ITO-1', 'ITS-2'));
    await getTicketContext('ITS-1', 'caller');
    expect(h.visibleIssueKeys.mock.calls[1][0]).toEqual(['ITO-1', 'ITS-2']);
  });

  it('leaves out internal bookkeeping fields and keeps what an agent needs', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1', 'ITO-1', 'ITS-2'));
    const r = (await getTicketContext('ITS-1', 'caller')) as Record<string, unknown>;
    expect(r).not.toHaveProperty('buildId');
    expect(r).not.toHaveProperty('ticketFingerprint');
    expect(r).toMatchObject({ ticketKey: 'ITS-1', builtAt: 't', partial: false, failures: [] });
    expect(Object.keys(r).sort()).toEqual(['articles', 'builtAt', 'failures', 'incidents', 'partial', 'resolutions', 'services', 'ticketKey']);
  });

  it('keeps the build ID on the pending response, as the spec defines it', async () => {
    h.getBundle.mockResolvedValue(undefined);
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
    expect(await getTicketContext('ITS-1', 'caller')).toHaveProperty('buildId', 'b-new');
  });

  it('annotates the verified summary for agents and renames rejected to unsupportedClaims', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1', 'ITO-1', 'ITS-2'));
    const viewer = { ...bundle, summary: { claims: [{ text: 'c', source: ref('ITO-1'), span: 's', grounded: true }], rejected: [{ text: 'made up', reason: 'no-matching-span' as const }], origin: 'llm' as const } };
    const out = toMcpBundle(viewer);
    expect(out.summary).toEqual({
      claimsNote: CLAIMS_NOTE,
      claims: viewer.summary.claims,
      unsupportedClaims: [{ text: 'made up', reason: 'no-matching-span', note: UNSUPPORTED_CLAIM_NOTE }],
      origin: 'llm',
    });
    expect(out).not.toHaveProperty('buildId');
  });

  it('leaves the summary out when the viewer has none', () => {
    const { summary: _none, ...withoutSummary } = bundle;
    expect(toMcpBundle(withoutSummary)).not.toHaveProperty('summary');
  });

  it('never returns the stored object itself', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1', 'ITO-1', 'ITS-2'));
    expect(await getTicketContext('ITS-1', 'caller')).not.toBe(bundle);
  });

  it('source check fails: drops every source and marks the response partial', async () => {
    h.visibleIssueKeys.mockImplementationOnce(sees('ITS-1')).mockRejectedValueOnce(new Error('jira-visibility-503'));
    const r = (await getTicketContext('ITS-1', 'caller')) as ContextBundle;
    expect(r.incidents).toEqual([]);
    expect(r.resolutions).toEqual([]);
    expect(r.partial).toBe(true);
    expect(r.failures).toEqual([AUTH_JIRA_CHECK_FAILED]);
  });

  it('does not queue a build when a bundle exists', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
    await getTicketContext('ITS-1', 'caller');
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
  });
});
