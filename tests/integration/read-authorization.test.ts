// Read-time authorization tests for the panel (spec §16.6; tests #1, #2, #10 and #11 for the Jira scope).
//
// Runs the real panel resolver, storage and filtering. Jira is simulated as a per-user permission
// table, mirroring what was verified on the demo site: user B is an ITS agent without ITO access.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextBundle, Incident, Resolution } from '../../src/domain/types';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  viewer: 'userA',
  canSee: {} as Record<string, string[]>,
  checkFails: false,
  checkCalls: [] as { viewer: string; keys: string[] }[],
  handlers: {} as Record<string, (req: unknown) => unknown>,
}));

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => structuredClone(h.store.get(key)),
    set: async (key: string, value: unknown) => void h.store.set(key, structuredClone(value)),
    delete: async (key: string) => void h.store.delete(key),
  },
}));
// Captures the handlers the panel registers, so tests can call them the way Forge does.
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
// The viewer visibility check, as the current viewer. Everything else in the adapter is unused here.
vi.mock('../../src/adapters/jira', () => ({
  visibleIssueKeys: async (keys: string[]) => {
    h.checkCalls.push({ viewer: h.viewer, keys });
    if (h.checkFails) throw new Error('jira-visibility-503');
    return new Set(keys.filter((k) => (h.canSee[h.viewer] ?? []).includes(k)));
  },
}));

import { getPanelContext, PanelState } from '../../src/resolvers/panel';
import { AUTH_JIRA_CHECK_FAILED, filterBundleForViewer } from '../../src/domain/authorize';

const ref = (id: string) => ({ kind: 'jira-issue' as const, id, url: `https://one-atlas-edlg.atlassian.net/browse/${id}`, title: id, updatedAt: 'u' });
const incident = (id: string, text: string): Incident => ({ source: ref(id), status: 'active', summary: text, relevance: 0.6 });
const resolution = (id: string, text: string): Resolution => ({ source: ref(id), resolvedAt: 't', resolutionText: text, matchReason: 'both', relevance: 0.4 });

// The demo scenario: ticket in ITS, the related incident and past fix in ITO, plus an ITS resolution.
const storedBundle: ContextBundle = {
  ticketKey: 'ITS-6265',
  builtAt: '2026-11-21T10:00:00.000Z',
  buildId: 'b1',
  ticketFingerprint: 'fp',
  incidents: [incident('ITO-9647', 'Auth service returning 503 errors (restricted ITO text)')],
  resolutions: [resolution('ITO-9642', 'Root cause: SSL certificate expired (restricted ITO text)'), resolution('ITS-6258', 'We reset the VPN today')],
  articles: [],
  services: [],
  partial: false,
  failures: [],
};
const storeBundle = () => {
  h.store.set('bundle:ITS-6265', storedBundle);
  h.store.set('status:ITS-6265', { ticketKey: 'ITS-6265', buildId: 'b1', requestedAt: 'r', status: 'complete', actor: { accountId: 'userA', source: 'jira-event' } });
};
const as = async (viewer: string): Promise<PanelState> => {
  h.viewer = viewer;
  return getPanelContext('ITS-6265');
};
const shown = (s: PanelState) => ('bundle' in s && s.bundle ? [...s.bundle.incidents, ...s.bundle.resolutions].map((x) => x.source.id) : []);

beforeEach(() => {
  h.store.clear();
  h.checkCalls = [];
  h.checkFails = false;
  h.canSee = {
    userA: ['ITS-6265', 'ITO-9647', 'ITO-9642', 'ITS-6258'], // ITS and ITO
    userB: ['ITS-6265', 'ITS-6258'], // ITS agent without ITO, as set up on the demo site
    userC: ['ITO-9647'], // cannot see the ticket
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('#1 two-user bundle isolation', () => {
  it('serves the same stored bundle differently to each viewer', async () => {
    storeBundle();
    expect(shown(await as('userA'))).toEqual(['ITO-9647', 'ITO-9642', 'ITS-6258']);
    expect(shown(await as('userB'))).toEqual(['ITS-6258']);
  });

  it('never sends restricted text to the viewer without access', async () => {
    storeBundle();
    const json = JSON.stringify(await as('userB'));
    expect(json).not.toContain('restricted ITO text');
    expect(json).not.toContain('ITO-9647');
    expect(json).not.toContain('ITO-9642');
  });

  it('does not tell the viewer that anything was filtered out', async () => {
    storeBundle();
    const b = await as('userB');
    expect(b.state).toBe('complete');
    if (b.state !== 'complete') return;
    expect(b.bundle.partial).toBe(false);
    expect(b.bundle.failures).toEqual([]);
  });

  it('checks visibility as the current viewer, every time', async () => {
    storeBundle();
    await as('userA');
    await as('userB');
    expect(h.checkCalls.map((c) => c.viewer)).toEqual(['userA', 'userB']);
    expect(h.checkCalls[1].keys).toEqual(['ITS-6265', 'ITO-9647', 'ITO-9642', 'ITS-6258']);
  });
});

describe('#2 ticket-level denial', () => {
  it('returns a bare unavailable state to a viewer who cannot see the ticket', async () => {
    storeBundle();
    expect(await as('userC')).toEqual({ state: 'unavailable' });
  });

  it('looks exactly the same whether or not a bundle exists', async () => {
    const withoutBundle = await as('userC');
    storeBundle();
    const withBundle = await as('userC');
    h.store.set('status:ITS-6265', { ticketKey: 'ITS-6265', buildId: 'b2', requestedAt: 'r', status: 'building', actor: { source: 'jira-event' } });
    const whileBuilding = await as('userC');
    expect(withBundle).toEqual(withoutBundle);
    expect(whileBuilding).toEqual(withoutBundle);
  });

  it('does not disguise denial as a pending or empty state', async () => {
    storeBundle();
    const s = await as('userC');
    expect(s.state).not.toBe('no-bundle');
    expect(s.state).not.toBe('queued');
    expect('bundle' in s).toBe(false);
  });

  it('even an authorized source in the bundle is not shown if the ticket is not visible', async () => {
    storeBundle();
    expect(JSON.stringify(await as('userC'))).not.toContain('ITO-9647');
  });
});

describe('#10 Jira-source isolation beyond ticket access', () => {
  it('access to the ticket is not access to its linked incident or past resolution', async () => {
    storeBundle();
    const b = await as('userB');
    expect(shown(b)).not.toContain('ITO-9647');
    expect(shown(b)).not.toContain('ITO-9642');
    expect(shown(b)).toContain('ITS-6258');
  });

  it('a viewer who can see the ticket but no sources gets empty sections, not an error', async () => {
    storeBundle();
    h.canSee.userB = ['ITS-6265'];
    const b = await as('userB');
    expect(b.state).toBe('complete');
    expect(shown(b)).toEqual([]);
  });
});

describe('#11 conservative default', () => {
  it('drops everything and shows unavailable when the visibility check fails', async () => {
    storeBundle();
    h.checkFails = true;
    expect(await as('userA')).toEqual({ state: 'unavailable' });
  });

  it('a failed check never falls back to the stored bundle', async () => {
    storeBundle();
    h.checkFails = true;
    expect(JSON.stringify(await as('userA'))).not.toContain('ITO-');
  });

  it('marks the response partial with auth:jira-check-failed when sources cannot be verified', async () => {
    // Exercised at the filter level: the panel fails closed on the ticket check before this point.
    const out = filterBundleForViewer(storedBundle, null);
    expect(out.partial).toBe(true);
    expect(out.failures).toContain(AUTH_JIRA_CHECK_FAILED);
    expect(shown({ state: 'complete', bundle: out })).toEqual([]);
  });
});

describe('getContext resolver entry point', () => {
  it('uses the ticket from the Forge context, never from the payload', async () => {
    storeBundle();
    h.viewer = 'userB';
    const res = (await h.handlers.getContext({ context: { extension: { issue: { key: 'ITS-6265' } } }, payload: { ticketKey: 'ITO-9647' } })) as PanelState;
    expect(shown(res)).toEqual(['ITS-6258']);
    expect(h.checkCalls[0].keys[0]).toBe('ITS-6265');
  });

  it('returns unavailable when the context has no issue', async () => {
    storeBundle();
    expect(await h.handlers.getContext({ context: { extension: {} } })).toEqual({ state: 'unavailable' });
    expect(await h.handlers.getContext({})).toEqual({ state: 'unavailable' });
    expect(h.checkCalls).toHaveLength(0);
  });
});

describe('panel states for an authorized viewer', () => {
  it('shows the empty state when no bundle exists yet', async () => {
    expect(await as('userA')).toEqual({ state: 'no-bundle' });
  });

  it('keeps the viewer-filtered last bundle visible while a newer build runs', async () => {
    storeBundle();
    h.store.set('status:ITS-6265', { ticketKey: 'ITS-6265', buildId: 'b2', requestedAt: 'r', status: 'building', actor: { source: 'jira-event' } });
    const b = await as('userB');
    expect(b.state).toBe('building');
    expect(shown(b)).toEqual(['ITS-6258']);
  });
});
