// Teams involved (step 11, Teamwork Graph) across viewers: security tests #1, #3, #5, #6 and #11 for TWG
// (spec §11.6, §16.6), under the agreed read-time-only design (domain/teams.ts).
//
// Runs the real panel resolver, MCP handler, storage, filtering and Teamwork Graph adapter. @forge/api is
// simulated per viewer: Jira visibility as verified on the demo site (user B is an ITS agent without ITO
// access), and Teamwork Graph with the response recorded there (tests/fixtures/twg-demo-site.json).
import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextBundle } from '../../src/domain/types';

const fixture: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'twg-demo-site.json'), 'utf8'));

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  viewer: 'userA',
  canSee: {} as Record<string, string[]>,
  // Teams each viewer can see in Teamwork Graph (it filters by the caller's permissions).
  graphSees: {} as Record<string, boolean>,
  graphFails: false,
  graphCalls: [] as { viewer: string; spaceAri: string }[],
}));

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => structuredClone(h.store.get(key)),
    set: async (key: string, value: unknown) => void h.store.set(key, structuredClone(value)),
    delete: async (key: string) => void h.store.delete(key),
  },
}));
vi.mock('@forge/resolver', () => ({ default: class { define() {} getDefinitions() { return {}; } } }));
vi.mock('@forge/events', () => ({ Queue: class { push = async () => ({ jobId: 'j' }); } }));
vi.mock('../../src/adapters/jira', () => ({
  visibleIssueKeys: async (keys: string[]) => new Set(keys.filter((k) => (h.canSee[h.viewer] ?? []).includes(k))),
}));
vi.mock('@forge/api', () => {
  const respond = (status: number, json: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  return {
    route: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((a, x, i) => a + x + (i < v.length ? String(v[i]) : ''), ''),
    default: {
      asApp: () => ({ requestJira: async (path: string) => respond(200, fixture.projects[/\/project\/(.+)$/.exec(path)?.[1] ?? ''] ?? {}) }),
      asUser: () => ({
        requestTeamworkGraph: async (_q: string, variables: { spaceAri: string }) => {
          h.graphCalls.push({ viewer: h.viewer, spaceAri: variables.spaceAri });
          if (h.graphFails) return respond(503, {});
          const empty = { data: { atlassianTeamsBySpace: { edges: [] } } };
          return respond(200, h.graphSees[h.viewer] ? (fixture.teamsBySpace[variables.spaceAri] ?? empty) : empty);
        },
      }),
    },
  };
});

import { getPanelContext, PanelState } from '../../src/resolvers/panel';
import { getTicketContext } from '../../src/resolvers/mcp';
import { TWG_UNAVAILABLE } from '../../src/domain/teams';

const ITO_ARI = `ari:cloud:jira:${fixture.cloudId}:project/10003`;
const ref = (id: string) => ({ kind: 'jira-issue' as const, id, url: `https://one-atlas-edlg.atlassian.net/browse/${id}`, title: id, updatedAt: 'u' });
const storedBundle: ContextBundle = {
  ticketKey: 'ITS-6265',
  builtAt: '2026-11-22T10:00:00.000Z',
  buildId: 'b1',
  ticketFingerprint: 'fp',
  incidents: [{ source: ref('ITO-9647'), status: 'active', summary: 'Login service is experiencing intermittent failures', relevance: 0.6 }],
  resolutions: [{ source: ref('ITS-6258'), resolvedAt: 't', resolutionText: 'We reset the VPN today', matchReason: 'same-symptom', relevance: 0.3 }],
  articles: [],
  services: [],
  partial: false,
  failures: [],
};
const as = async (viewer: string): Promise<PanelState> => {
  h.viewer = viewer;
  return getPanelContext('ITS-6265');
};
const bundleOf = (s: PanelState) => ('bundle' in s && s.bundle ? s.bundle : undefined);
const teamNames = (s: PanelState) => (bundleOf(s)?.teams ?? []).map((t) => t.name);

beforeEach(() => {
  h.store.clear();
  h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], savedAt: 't' });
  h.store.set('bundle:ITS-6265', storedBundle);
  h.store.set('status:ITS-6265', { ticketKey: 'ITS-6265', buildId: 'b1', requestedAt: 'r', status: 'complete', actor: { accountId: 'userA', source: 'jira-event' } });
  h.canSee = { userA: ['ITS-6265', 'ITO-9647', 'ITS-6258'], userB: ['ITS-6265', 'ITS-6258'], userD: ['ITS-6265', 'ITO-9647', 'ITS-6258'] };
  h.graphSees = { userA: true, userB: true, userD: false };
  h.graphFails = false;
  h.graphCalls = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('#1 two-viewer isolation (Teamwork Graph)', () => {
  it('user A sees Platform Support with the project and incident that connect it', async () => {
    const s = await as('userA');
    expect(bundleOf(s)?.teams).toEqual([
      {
        teamId: 'ari:cloud:identity::team/ad3bc097-95a0-41d6-8f61-779acaa56bd2',
        name: 'Platform Support',
        url: fixture.teamsBySpace[ITO_ARI].data.atlassianTeamsBySpace.edges[0].node.profileUrl,
        projectKey: 'ITO',
        incidentKey: 'ITO-9647',
        evidence: 'Linked to the ITO project, where ITO-9647 is tracked',
      },
    ]);
    expect(h.graphCalls).toEqual([{ viewer: 'userA', spaceAri: ITO_ARI }]);
  });

  it('user B, who cannot see the ITO incident, gets no team and causes no Teamwork Graph call', async () => {
    const s = await as('userB');
    expect(bundleOf(s)?.teams).toEqual([]);
    expect(bundleOf(s)?.partial).toBe(false);
    expect(JSON.stringify(s)).not.toContain('Platform Support');
    expect(h.graphCalls).toEqual([]);
  });
});

describe('#5/#6 every read is a fresh lookup as the current viewer', () => {
  it('a viewer who sees the incident but not the team in Teamwork Graph gets no team, without a failure', async () => {
    const s = await as('userD');
    expect(teamNames(s)).toEqual([]);
    expect(bundleOf(s)?.failures).toEqual([]);
    expect(h.graphCalls).toEqual([{ viewer: 'userD', spaceAri: ITO_ARI }]);
  });

  it('user A is looked up again on every read; nothing from an earlier read is reused', async () => {
    expect(teamNames(await as('userA'))).toEqual(['Platform Support']);
    h.graphSees.userA = false;
    expect(teamNames(await as('userA'))).toEqual([]);
    expect(h.graphCalls.map((c) => c.viewer)).toEqual(['userA', 'userA']);
  });
});

describe('#3 revoked access', () => {
  it('user A losing ITO access loses the team on the next read, with the same stored bundle', async () => {
    expect(teamNames(await as('userA'))).toEqual(['Platform Support']);
    h.canSee.userA = ['ITS-6265', 'ITS-6258'];
    expect(teamNames(await as('userA'))).toEqual([]);
    expect(h.graphCalls).toHaveLength(1);
    expect(h.store.get('bundle:ITS-6265')).toEqual(storedBundle);
  });
});

describe('#11 conservative default and failure isolation (§11.4, §11.5)', () => {
  it('a failed lookup drops the teams, records twg:unavailable, and leaves every other section as it was', async () => {
    h.graphFails = true;
    const b = bundleOf(await as('userA'))!;
    expect(b.teams).toEqual([]);
    expect(b.failures).toEqual([TWG_UNAVAILABLE]);
    expect(b.partial).toBe(true);
    expect(b.incidents.map((i) => i.source.id)).toEqual(['ITO-9647']);
    expect(b.resolutions.map((r) => r.source.id)).toEqual(['ITS-6258']);
  });

  it('teams are never stored in the bundle', async () => {
    await as('userA');
    expect(h.store.get('bundle:ITS-6265')).not.toHaveProperty('teams');
  });
});

describe('MCP get-ticket-context', () => {
  it('applies the same lookup per caller', async () => {
    h.viewer = 'userA';
    const a = (await getTicketContext({ ticketKey: 'ITS-6265' }, { principal: { accountId: 'userA' } })) as { teams?: { name: string; evidence: string }[] };
    expect(a.teams?.map((t) => [t.name, t.evidence])).toEqual([['Platform Support', 'Linked to the ITO project, where ITO-9647 is tracked']]);
    h.viewer = 'userB';
    const b = (await getTicketContext({ ticketKey: 'ITS-6265' }, { principal: { accountId: 'userB' } })) as { teams?: unknown[] };
    expect(b.teams).toEqual([]);
  });
});
