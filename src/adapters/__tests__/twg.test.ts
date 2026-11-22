// Teamwork Graph adapter tests against responses recorded on the demo site (tests/fixtures/twg-demo-site.json).
// No live calls (§19.7).
import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'twg-demo-site.json'), 'utf8'));

const h = vi.hoisted(() => ({
  calls: [] as { as: 'app' | 'user'; kind: 'jira' | 'graph'; path?: string; variables?: unknown; op?: string }[],
  projectStatus: 200,
  projectBody: undefined as unknown, // overrides the recorded project body
  graphStatus: 200,
  graphBody: undefined as unknown, // overrides the recorded graph body
  graphDelayMs: 0,
  graphThrows: false,
}));

vi.mock('@forge/api', () => {
  const respond = (status: number, json: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  return {
    route: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((a, x, i) => a + x + (i < v.length ? String(v[i]) : ''), ''),
    default: {
      asApp: () => ({
        requestJira: async (path: string) => {
          h.calls.push({ as: 'app', kind: 'jira', path });
          const key = /\/project\/(.+)$/.exec(path)?.[1] ?? '';
          return respond(h.projectStatus, h.projectBody ?? fixture.projects[key] ?? {});
        },
      }),
      asUser: () => ({
        requestTeamworkGraph: async (_query: string, variables: { spaceAri: string }, op: string) => {
          h.calls.push({ as: 'user', kind: 'graph', variables, op });
          if (h.graphThrows) throw new Error('network');
          if (h.graphDelayMs) await new Promise((r) => setTimeout(r, h.graphDelayMs));
          return respond(h.graphStatus, h.graphBody ?? fixture.teamsBySpace[variables.spaceAri] ?? { data: { atlassianTeamsBySpace: { edges: [] } } });
        },
      }),
    },
  };
});

import { teamsForProjects } from '../twg';

beforeEach(() => {
  h.calls = [];
  h.projectStatus = 200;
  h.projectBody = undefined;
  h.graphStatus = 200;
  h.graphBody = undefined;
  h.graphDelayMs = 0;
  h.graphThrows = false;
});

describe('teamsForProjects (read time, as the viewer)', () => {
  it('returns Platform Support for ITO and nothing for ITS, as recorded on the demo site', async () => {
    const teams = await teamsForProjects(['ITO', 'ITS']);
    expect(teams.get('ITO')).toEqual([{ id: 'ari:cloud:identity::team/ad3bc097-95a0-41d6-8f61-779acaa56bd2', name: 'Platform Support', url: fixture.teamsBySpace[`ari:cloud:jira:${fixture.cloudId}:project/10003`].data.atlassianTeamsBySpace.edges[0].node.profileUrl }]);
    expect(teams.get('ITS')).toEqual([]);
  });

  it('reads only project IDs as the app; every Teamwork Graph call runs as the viewer with the space ARI', async () => {
    await teamsForProjects(['ITO']);
    expect(h.calls).toEqual([
      { as: 'app', kind: 'jira', path: '/rest/api/3/project/ITO' },
      { as: 'user', kind: 'graph', variables: { spaceAri: 'ari:cloud:jira:799d4137-e456-418a-99c2-44019a5fc909:project/10003' }, op: 'outrider_teamsBySpace' },
    ]);
  });

  it('makes no call for no projects', async () => {
    expect((await teamsForProjects([])).size).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it('ignores nodes that are not teams or lack an ID or name', async () => {
    h.graphBody = { data: { atlassianTeamsBySpace: { edges: [{ node: { __typename: 'JiraSpace', id: 'x', displayName: 'x' } }, { node: { __typename: 'AtlassianTeam', id: 1, displayName: 'n' } }, { node: { __typename: 'AtlassianTeam', id: 't', displayName: 'T', profileUrl: 5 } }, {}] } } };
    expect((await teamsForProjects(['ITO'])).get('ITO')).toEqual([{ id: 't', name: 'T', url: undefined }]);
  });

  it('throws short codes on every failure, so the caller drops all teams', async () => {
    h.projectStatus = 404;
    await expect(teamsForProjects(['ITO'])).rejects.toThrow('twg-project-404');
    h.projectStatus = 200;
    h.projectBody = { id: '10003', self: 'not a url' };
    await expect(teamsForProjects(['ITO'])).rejects.toThrow('twg-project-id');
    h.projectBody = { id: 'x"', self: fixture.projects.ITO.self };
    await expect(teamsForProjects(['ITO'])).rejects.toThrow('twg-project-id');
    h.projectBody = { id: '10003' };
    await expect(teamsForProjects(['ITO'])).rejects.toThrow('twg-project-id');
    h.projectBody = undefined;
    h.graphStatus = 401;
    await expect(teamsForProjects(['ITO'])).rejects.toThrow('twg-401');
    h.graphStatus = 200;
    h.graphBody = { errors: [{ message: 'User is not permitted to query this organization' }], data: null };
    await expect(teamsForProjects(['ITO'])).rejects.toThrow('twg-query-error');
    h.graphBody = { data: {} };
    await expect(teamsForProjects(['ITO'])).rejects.toThrow('twg-shape');
    h.graphBody = { errors: [], data: { atlassianTeamsBySpace: { edges: [] } } };
    expect((await teamsForProjects(['ITO'])).get('ITO')).toEqual([]);
    h.graphBody = undefined;
    h.graphThrows = true;
    await expect(teamsForProjects(['ITO'])).rejects.toThrow('network');
  });

  it('gives up when the wall-clock budget runs out, however few calls remain (§11.6)', async () => {
    h.graphDelayMs = 200;
    await expect(teamsForProjects(['ITO'], 20)).rejects.toThrow('twg-timeout');
  });
});
