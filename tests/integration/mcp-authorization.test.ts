// MCP authorization tests for get-ticket-context (spec §15.1, §15.5, §16.2; security test #4).
//
// Runs the real action handler, tool logic, storage, filtering and enqueue code. Jira is simulated
// as a per-caller permission table (as verified on the demo site, asUser() in the action runs with the
// caller's permissions), and the queue records pushes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextBundle } from '../../src/domain/types';

const USER_A = '600a78342a6b66006918d911';
const USER_B = '712020:9a85d123-962d-424f-847e-1569a1b54f19';
const USER_C = 'no-ticket-access';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  pushes: [] as { body: unknown }[],
  caller: '',
  canSee: {} as Record<string, string[]>,
  failCheckNumber: 0, // fail the n-th visibility check of a call (1-based); 0 = never
  checks: [] as string[][],
  reads: [] as string[],
}));

// Teamwork Graph (step 11): no linked teams unless a test says otherwise; tests/integration/teams-authorization.test.ts covers teams.
vi.mock('../../src/adapters/twg', () => ({ teamsForProjects: async (keys: string[]) => ({ teams: new Map(keys.map((key) => [key, []])), failed: [] }) }));
vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => {
      h.reads.push(key);
      return structuredClone(h.store.get(key));
    },
    set: async (key: string, value: unknown) => void h.store.set(key, structuredClone(value)),
    delete: async (key: string) => void h.store.delete(key),
  },
}));
vi.mock('@forge/events', () => ({
  Queue: class {
    push = async (event: { body: unknown }) => {
      h.pushes.push(event);
      return { jobId: `job-${h.pushes.length}` };
    };
  },
}));
vi.mock('../../src/adapters/jira', () => ({
  visibleIssueKeys: async (keys: string[]) => {
    h.checks.push(keys);
    if (h.failCheckNumber && h.checks.length === h.failCheckNumber) throw new Error('jira-visibility-503');
    return new Set(keys.filter((k) => (h.canSee[h.caller] ?? []).includes(k)));
  },
}));

import { getTicketContext, resolveTicketKey } from '../../src/resolvers/mcp';
import { AUTH_JIRA_CHECK_FAILED } from '../../src/domain/authorize';
import { NOT_ACCESSIBLE_MESSAGE } from '../../src/mcp/tools';

const ref = (id: string) => ({ kind: 'jira-issue' as const, id, url: `https://x/browse/${id}`, title: id, updatedAt: 'u' });
const storedBundle: ContextBundle = {
  ticketKey: 'ITS-6265',
  builtAt: '2026-11-21T10:00:00.000Z',
  buildId: 'b1',
  ticketFingerprint: 'fp',
  incidents: [{ source: ref('ITO-9647'), status: 'active', summary: 'Auth 503 errors (restricted ITO text)', relevance: 0.6 }],
  resolutions: [
    { source: ref('ITO-9642'), resolvedAt: 't', resolutionText: 'SSL certificate expired (restricted ITO text)', matchReason: 'both', relevance: 0.4 },
    { source: ref('ITS-6258'), resolvedAt: 't', resolutionText: 'We reset the VPN today', matchReason: 'same-symptom', relevance: 0.3 },
  ],
  articles: [],
  services: [],
  partial: false,
  failures: [],
};
const storeBundle = () => h.store.set('bundle:ITS-6265', storedBundle);
const call = (caller: string | undefined, payload: Record<string, unknown> = { ticketKey: 'ITS-6265' }) => {
  h.caller = caller ?? '';
  return getTicketContext(payload, caller === undefined ? { installContext: 'x' } : { principal: { accountId: caller } });
};
const ids = (r: unknown) => {
  const b = r as ContextBundle;
  return [...(b.incidents ?? []), ...(b.resolutions ?? [])].map((x) => x.source.id);
};

beforeEach(() => {
  h.store.clear();
  h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], affectedServicesField: 'customfield_10039', requestTypeField: 'customfield_10010', savedAt: 't' }); // explicit site settings (Phase 5.5)
  h.pushes = [];
  h.checks = [];
  h.reads = [];
  h.failCheckNumber = 0;
  h.canSee = {
    [USER_A]: ['ITS-6265', 'ITO-9647', 'ITO-9642', 'ITS-6258'],
    [USER_B]: ['ITS-6265', 'ITS-6258'],
    [USER_C]: ['ITO-9647'],
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('#4 MCP caller isolation', () => {
  it('returns the same stored bundle filtered for each caller', async () => {
    storeBundle();
    expect(ids(await call(USER_A))).toEqual(['ITO-9647', 'ITO-9642', 'ITS-6258']);
    expect(ids(await call(USER_B))).toEqual(['ITS-6258']);
  });

  it('never exposes internal build fields to a caller', async () => {
    storeBundle();
    for (const caller of [USER_A, USER_B]) {
      const json = JSON.stringify(await call(caller));
      expect(json).not.toContain('"buildId"');
      expect(json).not.toContain('ticketFingerprint');
    }
  });

  it('a different caller does not inherit the build actor', async () => {
    storeBundle();
    h.store.set('status:ITS-6265', { ticketKey: 'ITS-6265', buildId: 'b1', requestedAt: 'r', status: 'complete', actor: { accountId: USER_A, source: 'jira-event' } });
    const json = JSON.stringify(await call(USER_B));
    expect(json).not.toContain('restricted ITO text');
    expect(json).not.toContain('ITO-96');
  });

  it('a caller without access to the ticket gets an authorization failure, not a filtered bundle', async () => {
    storeBundle();
    expect(await call(USER_C)).toEqual({ status: 'not-accessible', ticketKey: 'ITS-6265', message: NOT_ACCESSIBLE_MESSAGE });
  });

  it('does not tell a caller that anything was filtered out', async () => {
    storeBundle();
    const r = (await call(USER_B)) as ContextBundle;
    expect(r.partial).toBe(false);
    expect(r.failures).toEqual([]);
  });
});

describe('authorization before side effects (§15.1)', () => {
  it('does not read the bundle, queue a build or return pending for an unauthorized caller', async () => {
    const r = await call(USER_C);
    expect(r).toMatchObject({ status: 'not-accessible' });
    expect(h.pushes).toHaveLength(0);
    expect(h.reads).toEqual([]);
  });

  it('looks identical whether or not a bundle or a build exists', async () => {
    const none = await call(USER_C);
    storeBundle();
    const withBundle = await call(USER_C);
    h.store.set('status:ITS-6265', { ticketKey: 'ITS-6265', buildId: 'b2', requestedAt: 'r', status: 'building', actor: { source: 'jira-event' } });
    const whileBuilding = await call(USER_C);
    expect(withBundle).toEqual(none);
    expect(whileBuilding).toEqual(none);
  });

  it('treats a nonexistent ticket exactly like an inaccessible one', async () => {
    const missing = await call(USER_A, { ticketKey: 'ITS-999999' });
    expect(missing).toEqual({ status: 'not-accessible', ticketKey: 'ITS-999999', message: NOT_ACCESSIBLE_MESSAGE });
  });

  it('fails closed when the ticket check itself fails', async () => {
    storeBundle();
    h.failCheckNumber = 1;
    expect(await call(USER_A)).toMatchObject({ status: 'not-accessible' });
    expect(h.pushes).toHaveLength(0);
  });

  it('checks the ticket alone first, then the sources', async () => {
    storeBundle();
    await call(USER_A);
    expect(h.checks[0]).toEqual(['ITS-6265']);
    expect(h.checks[1]).toEqual(['ITO-9647', 'ITO-9642', 'ITS-6258']);
  });
});

describe('cold start for an authorized caller (§15.1)', () => {
  it('queues one build and returns the pending shape', async () => {
    const r = await call(USER_A);
    expect(r).toMatchObject({ status: 'pending', ticketKey: 'ITS-6265' });
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].body).toMatchObject({ kind: 'jira-ticket', ticketKey: 'ITS-6265', actor: { accountId: USER_A } });
    expect((r as { buildId: string }).buildId).toBe((h.pushes[0].body as { buildId: string }).buildId);
  });

  it('does not queue another build while one is in flight', async () => {
    const first = await call(USER_A);
    const second = await call(USER_B);
    expect(h.pushes).toHaveLength(1);
    expect((second as { buildId: string }).buildId).toBe((first as { buildId: string }).buildId);
  });

  it('queues a fresh build when the last one failed and no bundle exists', async () => {
    h.store.set('status:ITS-6265', { ticketKey: 'ITS-6265', buildId: 'old', requestedAt: 'r', status: 'failed', actor: { source: 'jira-event' } });
    await call(USER_A);
    expect(h.pushes).toHaveLength(1);
  });
});

describe('conservative default for sources (§16.5)', () => {
  it('drops every source and marks the response partial when the source check fails', async () => {
    storeBundle();
    h.failCheckNumber = 2;
    const r = (await call(USER_A)) as ContextBundle;
    expect(ids(r)).toEqual([]);
    expect(r.partial).toBe(true);
    expect(r.failures).toContain(AUTH_JIRA_CHECK_FAILED);
  });
});

describe('inputs never authorize (§15.5)', () => {
  it('refuses a call without an authenticated caller and never checks or reads anything', async () => {
    storeBundle();
    expect(await call(undefined)).toMatchObject({ status: 'invalid-request' });
    expect(h.checks).toHaveLength(0);
    expect(h.reads).toHaveLength(0);
  });

  it('ignores an account ID supplied in the inputs', async () => {
    storeBundle();
    const r = await call(USER_C, { ticketKey: 'ITS-6265', accountId: USER_A, principal: { accountId: USER_A } });
    expect(r).toMatchObject({ status: 'not-accessible' });
  });

  it('an account ID in the inputs cannot stand in for a missing caller', async () => {
    h.caller = USER_A;
    const r = await getTicketContext({ ticketKey: 'ITS-6265', accountId: USER_A }, { installContext: 'x' });
    expect(r).toMatchObject({ status: 'invalid-request' });
    expect(h.checks).toHaveLength(0);
  });

  it('records the real caller, not an input account ID, as the actor of a queued build', async () => {
    await call(USER_B, { ticketKey: 'ITS-6265', accountId: USER_A });
    expect(h.pushes[0].body).toMatchObject({ actor: { accountId: USER_B } });
  });

  it('rejects input that is not an issue key before it reaches Jira', async () => {
    expect(await call(USER_A, { ticketKey: 'ITS-1) OR project = ITO OR key in (X-1' })).toMatchObject({ status: 'invalid-request' });
    expect(h.checks).toHaveLength(0);
  });
});

describe('resolveTicketKey', () => {
  it('uses a valid input key, normalizing case and spaces', () => {
    expect(resolveTicketKey({ ticketKey: ' its-6265 ' })).toBe('ITS-6265');
  });

  it('falls back to the issue the user is viewing when the input is missing or invalid', () => {
    expect(resolveTicketKey({ context: { jira: { issueKey: 'ITS-6265' } } })).toBe('ITS-6265');
    expect(resolveTicketKey({ ticketKey: 'not a key', context: { jira: { issueKey: 'ITS-6265' } } })).toBe('ITS-6265');
  });

  it('returns undefined when neither is a valid key', () => {
    expect(resolveTicketKey({})).toBeUndefined();
    expect(resolveTicketKey({ ticketKey: 42, context: { jira: { issueKey: 1 } } })).toBeUndefined();
    expect(resolveTicketKey({ ticketKey: 'ITS-' })).toBeUndefined();
  });
});
