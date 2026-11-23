// Request clustering end to end (step 13): spec §14.9, §14.12 "Permission filtering at retrieval" and
// "Authorization parity", and CLAUDE §6.2 (duplicate delivery, resolve). Runs the real clustering pass, KVS
// storage, panel resolver, MCP tool and Dismiss. Simulated: KVS (with begins-with queries), the queue, the open
// requests Jira returns to the app, and per-viewer Jira visibility (user B cannot see ITS-5, as with ITO on the
// demo site).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClusterRecord } from '../../src/domain/cluster';
import { ContextBundle } from '../../src/domain/types';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  pushes: [] as { body: { kind: string }; delayInSeconds?: number }[],
  requests: [] as { key: string; createdAt: string; serviceIds: string[]; entities: { kind: 'component'; id: string }[] }[],
  viewer: 'userA',
  canSee: {} as Record<string, string[]>,
  checkFails: false,
  // Number of visibility checks that succeed before every later one fails; -1 for never.
  failAfterChecks: -1,
  checks: 0,
  handlers: {} as Record<string, (req: unknown) => unknown>,
}));

vi.mock('@forge/kvs', () => ({
  WhereConditions: { beginsWith: (value: string) => ({ condition: 'BEGINS_WITH', value }) },
  kvs: {
    get: async (key: string) => structuredClone(h.store.get(key)),
    set: async (key: string, value: unknown, options?: { keyPolicy?: string }) => {
      if (options?.keyPolicy === 'FAIL_IF_EXISTS' && h.store.has(key)) throw new Error('conflict');
      h.store.set(key, structuredClone(value));
    },
    delete: async (key: string) => void h.store.delete(key),
    query: () => {
      let prefix = '';
      const builder = {
        where: (_p: string, c: { value: string }) => ((prefix = c.value), builder),
        limit: () => builder,
        cursor: () => builder,
        getMany: async () => ({ results: [...h.store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })) }),
      };
      return builder;
    },
  },
}));
vi.mock('@forge/events', () => ({ Queue: class { push = async (e: { body: { kind: string } }) => void h.pushes.push(e); } }));
vi.mock('@forge/resolver', () => ({
  default: class {
    define(name: string, fn: (req: unknown) => unknown) {
      h.handlers[name] = fn;
    }
    getDefinitions() {
      return {};
    }
  },
}));
vi.mock('../../src/adapters/clusterSource', () => ({
  openRequestsForClustering: async () => ({ requests: structuredClone(h.requests), serviceNames: new Map([['svc-vpn', 'Infrastructure Services']]), entityNames: new Map([['10014', 'VPN Server']]) }),
}));
vi.mock('../../src/adapters/jira', () => ({
  visibleIssueKeys: async (keys: string[]) => {
    h.checks++;
    if (h.checkFails || (h.failAfterChecks >= 0 && h.checks > h.failAfterChecks)) throw new Error('jira-visibility-503');
    return new Set(keys.filter((k) => (h.canSee[h.viewer] ?? []).includes(k)));
  },
}));
vi.mock('../../src/adapters/twg', () => ({ teamsForProjects: async (keys: string[]) => ({ teams: new Map(keys.map((k) => [k, []])), failed: [] }) }));

import { runClusterPass } from '../../src/pipeline/clusterPass';
import { getPanelContext, PanelState } from '../../src/resolvers/panel';
import { getEmergingIncidents } from '../../src/resolvers/mcp';
import { CLUSTER_CHECK_FAILED, dismissSignal } from '../../src/resolvers/signals';
import { SIGNALS_NOTE } from '../../src/mcp/tools';

const NOW = new Date('2026-11-23T10:30:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const vpnRequest = (n: number, m: number) => ({ key: `ITS-${n}`, createdAt: minutesAgo(m), serviceIds: ['SVC-VPN'], entities: [{ kind: 'component' as const, id: '10014' }] });
const job = { kind: 'cluster-pass' as const, projectKey: 'ITS', buildId: 'pass-1', requestedAt: NOW.toISOString(), actor: { source: 'jira-event' as const } };
const records = () => [...h.store.entries()].filter(([k]) => k.startsWith('cluster:')).map(([, v]) => v as ClusterRecord);
const panel = async (viewer: string, ticket = 'ITS-1'): Promise<PanelState> => {
  h.viewer = viewer;
  return getPanelContext(ticket);
};
const signalsOf = (s: PanelState) => ('bundle' in s && s.bundle ? s.bundle.emergingSignals ?? [] : []);
const caller = (viewer: string) => {
  h.viewer = viewer;
  return { principal: { accountId: viewer } };
};

// Read time hides signals whose window has ended, so the panel and MCP reads run at the passes' NOW.
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  h.store.clear();
  h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS'], affectedServicesField: 'customfield_10039', clusterEntityField: 'components', savedAt: 't' });
  for (const n of [1, 2, 3, 4, 5]) {
    const bundle: ContextBundle = { ticketKey: `ITS-${n}`, builtAt: 't', buildId: 'b', ticketFingerprint: 'f', incidents: [], resolutions: [], articles: [], services: [], partial: false, failures: [] };
    h.store.set(`bundle:ITS-${n}`, bundle);
    h.store.set(`status:ITS-${n}`, { ticketKey: `ITS-${n}`, buildId: 'b', requestedAt: 'r', status: 'complete', actor: { source: 'jira-event' } });
  }
  h.requests = [vpnRequest(1, 25), vpnRequest(2, 20), vpnRequest(3, 15), vpnRequest(4, 10), vpnRequest(5, 5)];
  h.pushes = [];
  h.checkFails = false;
  h.failAfterChecks = -1;
  h.checks = 0;
  h.canSee = { userA: ['ITS-1', 'ITS-2', 'ITS-3', 'ITS-4', 'ITS-5'], userB: ['ITS-1', 'ITS-2', 'ITS-3', 'ITS-4'] };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the clustering pass', () => {
  it('raises one confirmed signal for five requests with the same service and component (default threshold 5)', async () => {
    await runClusterPass(job, NOW);
    const [r] = records();
    expect(records()).toHaveLength(1);
    expect(r).toMatchObject({ state: 'confirmed', lifecycle: 'raised', serviceName: 'Infrastructure Services', entityName: 'VPN Server', requestKeys: ['ITS-1', 'ITS-2', 'ITS-3', 'ITS-4', 'ITS-5'], windowStart: minutesAgo(25) });
  });

  it('duplicate delivery: running the same pass again writes nothing new', async () => {
    await runClusterPass(job, NOW);
    const before = JSON.stringify(records());
    await runClusterPass(job, new Date(NOW.getTime() + 60_000));
    expect(JSON.stringify(records())).toBe(before);
  });

  it('expires the signal when requests close and fewer than the threshold stay open', async () => {
    await runClusterPass(job, NOW);
    h.requests = h.requests.slice(0, 3);
    await runClusterPass(job, NOW);
    expect(records()[0].lifecycle).toBe('expired');
  });

  it('skips a project that does not get context, or a site with no identity field', async () => {
    await runClusterPass({ ...job, projectKey: 'HR' }, NOW);
    h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS'], savedAt: 't' });
    await runClusterPass(job, NOW);
    expect(records()).toEqual([]);
  });

  it('re-queues itself when another pass holds the project lock', async () => {
    h.store.set('lock:cluster-pass_ITS', { buildId: 'other', ownerToken: 'x', acquiredAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 600_000).toISOString() });
    await runClusterPass(job, NOW);
    expect(records()).toEqual([]);
    expect(h.pushes).toEqual([{ body: job, delayInSeconds: 30 }]);
  });

  it('deletes records that ended more than seven days ago, and releases its lock', async () => {
    await runClusterPass(job, NOW);
    const old = { ...records()[0], lifecycle: 'expired' as const, storageKey: 'cluster:ITS:confirmed:x:component:y:old', windowEnd: '2026-11-01T00:00:00.000Z' };
    h.store.set(old.storageKey, old);
    await runClusterPass(job, NOW);
    expect(h.store.has(old.storageKey)).toBe(false);
    expect(h.store.has('lock:cluster-pass_ITS')).toBe(false);
  });
});

describe('permission filtering at retrieval (§14.9)', () => {
  it('user A sees the signal on every request in it, with all five requests', async () => {
    await runClusterPass(job, NOW);
    for (const t of ['ITS-1', 'ITS-5']) {
      const [s] = signalsOf(await panel('userA', t));
      expect(s).toMatchObject({ state: 'confirmed', requestCount: 5, serviceName: 'Infrastructure Services', entityKind: 'component', entityName: 'VPN Server' });
    }
  });

  it('user B, who can see only four of the five, gets no signal and learns nothing about ITS-5', async () => {
    await runClusterPass(job, NOW);
    const s = await panel('userB');
    expect(signalsOf(s)).toEqual([]);
    expect(JSON.stringify(s)).not.toContain('ITS-5');
    expect(JSON.stringify(s)).not.toContain('VPN Server');
    expect('bundle' in s && s.bundle?.partial).toBe(false);
  });

  it('a failed check for the signal requests shows no signal and marks the response partial; the rest still shows', async () => {
    await runClusterPass(job, NOW);
    h.viewer = 'userA';
    h.checks = 0;
    h.failAfterChecks = 1; // the ticket gate succeeds, the signal's request check fails
    const s = await getPanelContext('ITS-1');
    expect(s.state).toBe('complete');
    expect(signalsOf(s)).toEqual([]);
    expect('bundle' in s && s.bundle?.failures).toContain(CLUSTER_CHECK_FAILED);
    expect('bundle' in s && s.bundle?.partial).toBe(true);
  });
  it('no signal is shown on a ticket that is not part of it', async () => {
    await runClusterPass(job, NOW);
    h.store.set('bundle:ITS-9', { ...(h.store.get('bundle:ITS-1') as ContextBundle), ticketKey: 'ITS-9' });
    h.canSee.userA.push('ITS-9');
    expect(signalsOf(await panel('userA', 'ITS-9'))).toEqual([]);
  });
});

describe('get-emerging-incidents applies the same rules as the panel (authorization parity)', () => {
  it('returns the signal to user A with the advisory note, and nothing to user B', async () => {
    await runClusterPass(job, NOW);
    const a = (await getEmergingIncidents({}, caller('userA'))) as { signals: { requestCount: number }[]; signalsNote?: string; partial: boolean };
    expect(a.signals.map((s) => s.requestCount)).toEqual([5]);
    expect(a.signalsNote).toBe(SIGNALS_NOTE);
    expect(a.partial).toBe(false);
    const b = (await getEmergingIncidents({ projectKey: 'its' }, caller('userB'))) as { signals: unknown[]; signalsNote?: string };
    expect(b.signals).toEqual([]);
    expect(b).not.toHaveProperty('signalsNote');
  });

  it('reports a failed check as partial with no signals', async () => {
    await runClusterPass(job, NOW);
    h.checkFails = true;
    expect(await getEmergingIncidents({}, caller('userA'))).toEqual({ signals: [], partial: true, failures: [CLUSTER_CHECK_FAILED] });
  });

  it('needs a caller, a valid project key, and a project that gets context', async () => {
    expect(await getEmergingIncidents({}, {})).toMatchObject({ status: 'invalid-request' });
    expect(await getEmergingIncidents({ projectKey: 'not a key' }, caller('userA'))).toMatchObject({ status: 'invalid-request' });
    expect(await getEmergingIncidents({ projectKey: 'HR' }, caller('userA'))).toMatchObject({ status: 'not-set-up' });
    h.store.delete('settings:site');
    expect(await getEmergingIncidents({}, caller('userA'))).toMatchObject({ status: 'not-set-up' });
  });
});

describe('Dismiss (§14.7 resolved by a human)', () => {
  it('user B cannot dismiss a signal they cannot see; nothing changes', async () => {
    await runClusterPass(job, NOW);
    h.viewer = 'userB';
    expect(await dismissSignal('ITS-1', records()[0].signalId)).toEqual({ ok: false });
    expect(records()[0].lifecycle).toBe('raised');
  });

  it('user A dismisses it from the panel: it is resolved, hidden, and not raised again in its window', async () => {
    await runClusterPass(job, NOW);
    h.viewer = 'userA';
    const res = await h.handlers.dismissSignal({ context: { extension: { issue: { key: 'ITS-1' } } }, payload: { signalId: records()[0].signalId } });
    expect(res).toEqual({ ok: true });
    expect(records()[0].lifecycle).toBe('resolved');
    expect(signalsOf(await panel('userA'))).toEqual([]);
    await runClusterPass(job, NOW);
    expect(records()).toHaveLength(1);
  });

  it('refuses bad input, unknown signals, tickets outside the signal, and a failed check', async () => {
    await runClusterPass(job, NOW);
    h.viewer = 'userA';
    expect(await h.handlers.dismissSignal({ context: { extension: {} }, payload: { signalId: 'x' } })).toEqual({ ok: false });
    expect(await h.handlers.dismissSignal({ context: { extension: { issue: { key: 'ITS-1' } } }, payload: {} })).toEqual({ ok: false });
    expect(await dismissSignal('ITS-1', 'no-such-signal')).toEqual({ ok: false });
    h.canSee.userA.push('ITS-9');
    expect(await dismissSignal('ITS-9', records()[0].signalId)).toEqual({ ok: false });
    h.canSee.userA = h.canSee.userA.filter((k) => k !== 'ITS-1');
    expect(await dismissSignal('ITS-1', records()[0].signalId)).toEqual({ ok: false });
    h.checkFails = true;
    expect(await dismissSignal('ITS-2', records()[0].signalId)).toEqual({ ok: false });
    expect(records()[0].lifecycle).toBe('raised');
  });
});
