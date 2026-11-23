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
  graphBodies: [] as unknown[], // overrides graphBody for the next calls, one per call
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
          const next = h.graphBodies.length > 0 ? h.graphBodies.shift() : undefined;
          return respond(h.graphStatus, next ?? h.graphBody ?? fixture.teamsBySpace[variables.spaceAri] ?? { data: { atlassianTeamsBySpace: { edges: [] } } });
        },
      }),
    },
  };
});

import { TEAM_LOOKUP_ATTEMPTS, TEAM_RETRY_DELAY_MS, teamsForProjects } from '../twg';

/** The error recorded for the only project looked up; '' if it answered. */
const failureOf = async (keys: string[], budgetMs?: number): Promise<string> => {
  const r = await teamsForProjects(keys, budgetMs, 0);
  return r.failed[0]?.error ?? '';
};

beforeEach(() => {
  h.calls = [];
  h.projectStatus = 200;
  h.projectBody = undefined;
  h.graphStatus = 200;
  h.graphBody = undefined;
  h.graphBodies = [];
  h.graphDelayMs = 0;
  h.graphThrows = false;
});

describe('teamsForProjects (read time, as the viewer)', () => {
  it('returns Platform Support for ITO and nothing for ITS, as recorded on the demo site', async () => {
    const { teams, failed } = await teamsForProjects(['ITO', 'ITS']);
    expect(failed).toEqual([]);
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
    expect(await teamsForProjects([])).toEqual({ teams: new Map(), failed: [] });
    expect(h.calls).toEqual([]);
  });

  it('ignores nodes that are not teams or lack an ID or name', async () => {
    h.graphBody = { data: { atlassianTeamsBySpace: { edges: [{ node: { __typename: 'JiraSpace', id: 'x', displayName: 'x' } }, { node: { __typename: 'AtlassianTeam', id: 1, displayName: 'n' } }, { node: { __typename: 'AtlassianTeam', id: 't', displayName: 'T', profileUrl: 5 } }, {}] } } };
    expect((await teamsForProjects(['ITO'])).teams.get('ITO')).toEqual([{ id: 't', name: 'T', url: undefined }]);
  });

  it('reports a short code for every failure, per project, and never throws', async () => {
    h.projectStatus = 404;
    expect(await failureOf(['ITO'])).toContain('twg-project-404');
    h.projectStatus = 200;
    h.projectBody = { id: '10003', self: 'not a url' };
    expect(await failureOf(['ITO'])).toContain('twg-project-id');
    h.projectBody = { id: 'x"', self: fixture.projects.ITO.self };
    expect(await failureOf(['ITO'])).toContain('twg-project-id');
    h.projectBody = { id: '10003' };
    expect(await failureOf(['ITO'])).toContain('twg-project-id');
    h.projectBody = undefined;
    h.graphStatus = 401;
    expect(await failureOf(['ITO'])).toContain('twg-401');
    h.graphStatus = 200;
    h.graphBody = { errors: [{ message: 'User is not permitted to query this organization' }], data: null };
    expect(await failureOf(['ITO'])).toContain('twg-query-error: User is not permitted to query this organization');
    // The log line carries the first two messages and their classification, cut to 200 characters.
    h.graphBody = { errors: [{ message: 'Field undefined', extensions: { classification: 'ValidationError', statusCode: 400 } }, { message: 'x'.repeat(300) }, { message: 'third' }], data: null };
    const err = await failureOf(['ITO']);
    expect(err.startsWith('twg-query-error: Field undefined (ValidationError 400); xxx')).toBe(true);
    expect(err).not.toContain('third');
    expect(err.length).toBe('twg-query-error: '.length + 200);
    h.graphBody = { errors: ['not an object'], data: null };
    expect(await failureOf(['ITO'])).toContain('twg-query-error: no message');
    h.graphBody = { data: {} };
    expect(await failureOf(['ITO'])).toContain('twg-shape');
    h.graphBody = { errors: [], data: { atlassianTeamsBySpace: { edges: [] } } };
    expect((await teamsForProjects(['ITO'])).teams.get('ITO')).toEqual([]);
    h.graphBody = undefined;
    h.graphThrows = true;
    expect(await failureOf(['ITO'])).toContain('network');
  });

  it('retries only the intermittent "not permitted to query this organization" refusal, at most 5 attempts', async () => {
    // As seen on the demo site (2026-11-23): HTTP 200, a ValidationError, and a non-null error on cypherQueryV2.
    const refusal = { errors: [{ message: 'User is not permitted to query this organization', extensions: { classification: 'ValidationError' } }, { message: "The field at path '/graphStore/cypherQueryV2' was declared as a non null type" }], data: null };
    const graphCalls = () => h.calls.filter((c) => c.kind === 'graph').length;
    expect(TEAM_LOOKUP_ATTEMPTS).toBe(5);
    expect(TEAM_RETRY_DELAY_MS).toBe(300);

    h.graphBodies = [refusal, refusal, refusal, refusal];
    expect((await teamsForProjects(['ITO'], 4000, 0)).teams.get('ITO')?.map((t) => t.name)).toEqual(['Platform Support']);
    expect(graphCalls()).toBe(5);

    h.calls = [];
    h.graphBodies = [refusal, refusal, refusal, refusal, refusal, refusal];
    expect((await teamsForProjects(['ITO'], 4000, 0)).failed[0].error).toContain('twg-query-error: User is not permitted to query this organization (ValidationError)');
    expect(graphCalls()).toBe(5);

    h.calls = [];
    h.graphBodies = [{ errors: [{ message: 'Field undefined' }], data: null }];
    expect(await failureOf(['ITO'])).toContain('twg-query-error: Field undefined');
    expect(graphCalls()).toBe(1);
  });

  it('pauses between tries and stops retrying once the next try would end after the deadline', async () => {
    const refusal = { errors: [{ message: 'User is not permitted to query this organization' }], data: null };
    h.graphBodies = Array.from({ length: 10 }, () => refusal);
    const started = Date.now();
    const r = await teamsForProjects(['ITO'], 100, 60);
    // Try 1 at 0 ms, a 60 ms pause, try 2 at about 60 ms; a third pause would end after the 100 ms deadline.
    expect(h.calls.filter((c) => c.kind === 'graph')).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
    expect(r.failed[0].error).toContain('twg-query-error');
  });

  it('keeps the teams of a project that answered when another project is refused (ITS-6275 on the demo site)', async () => {
    const refusal = { errors: [{ message: 'User is not permitted to query this organization' }], data: null };
    const itsAri = `ari:cloud:jira:${fixture.cloudId}:project/${fixture.projects.ITS.id}`;
    // Only the ITS lookup is refused, on every attempt.
    h.graphBody = undefined;
    const real = fixture.teamsBySpace;
    fixture.teamsBySpace = { ...real, [itsAri]: refusal };
    try {
      const { teams, failed } = await teamsForProjects(['ITO', 'ITS']);
      expect(teams.get('ITO')?.map((t) => t.name)).toEqual(['Platform Support']);
      expect(teams.has('ITS')).toBe(false);
      expect(failed).toEqual([{ projectKey: 'ITS', error: 'twg-query-error: User is not permitted to query this organization' }]);
    } finally {
      fixture.teamsBySpace = real;
    }
  });

  it('gives up when the wall-clock budget runs out, however few calls remain (§11.6)', async () => {
    h.graphDelayMs = 200;
    expect(await failureOf(['ITO'], 20)).toContain('twg-timeout');
  });
});
