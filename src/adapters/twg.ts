// Teamwork Graph adapter (step 11). Read time only, AS THE VIEWER: Forge apps cannot call Teamwork Graph as
// the app, and the queue consumer cannot call it at all (probed on the demo site; see domain/teams.ts).
//
// Verified on the demo site (2026-11-22): atlassianTeamsBySpace for the ITO space returned Platform Support,
// with its profile URL, about a minute after the team was linked to the project. A space with no linked team
// returns an empty list. A missing scope also returns an empty list, not an error (Teamwork Graph docs).
import api, { route } from '@forge/api';
import { GraphTeam } from '../domain/teams';

// Wall-clock budget for all lookups in one read (spec §11.6: time, not only call count, is the limit).
export const TEAM_LOOKUP_BUDGET_MS = 4000;

const TEAMS_BY_SPACE = `query outrider_teamsBySpace($spaceAri: ID!) {
  atlassianTeamsBySpace(spaceAri: $spaceAri, first: 25) {
    edges { node { __typename ... on AtlassianTeam { id displayName profileUrl } } }
  }
}`;

// Jira project IDs and the cloud ID are digits and a UUID; anything else never goes into an ARI.
const PROJECT_ID = /^\d+$/;
const CLOUD_ID = /^[0-9a-f-]{36}$/i;

/**
 * The Teamwork Graph ARI of a Jira project (a Jira space). The project ID and the cloud ID come from the
 * project's REST resource; its self link is the API gateway URL https://api.atlassian.com/ex/jira/<cloudId>/...
 * Read as the app: the project key comes from an incident the viewer can already see, and an ID reveals nothing.
 */
async function spaceAri(projectKey: string): Promise<string> {
  const res = await api.asApp().requestJira(route`/rest/api/3/project/${projectKey}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`twg-project-${res.status}`);
  const p = (await res.json()) as { id?: unknown; self?: unknown };
  const id = typeof p.id === 'string' ? p.id : '';
  let cloudId = '';
  try {
    cloudId = typeof p.self === 'string' ? (new URL(p.self).pathname.split('/')[3] ?? '') : '';
  } catch {
    cloudId = '';
  }
  if (!PROJECT_ID.test(id) || !CLOUD_ID.test(cloudId)) throw new Error('twg-project-id');
  return `ari:cloud:jira:${cloudId}:project/${id}`;
}

type TeamsResponse = {
  data?: { atlassianTeamsBySpace?: { edges?: { node?: { __typename?: string; id?: unknown; displayName?: unknown; profileUrl?: unknown } }[] } };
  errors?: unknown[];
};

/** Teams linked to one Jira project, as the viewer. Throws a short code on any failure. */
async function teamsForProject(projectKey: string): Promise<GraphTeam[]> {
  const ari = await spaceAri(projectKey);
  const res = await api.asUser().requestTeamworkGraph(TEAMS_BY_SPACE, { spaceAri: ari }, 'outrider_teamsBySpace');
  if (!res.ok) throw new Error(`twg-${res.status}`);
  const body = (await res.json()) as TeamsResponse;
  if (body.errors && body.errors.length > 0) throw new Error('twg-query-error');
  const edges = body.data?.atlassianTeamsBySpace?.edges;
  if (!Array.isArray(edges)) throw new Error('twg-shape');
  const teams: GraphTeam[] = [];
  for (const e of edges) {
    const n = e?.node;
    if (n?.__typename !== 'AtlassianTeam' || typeof n.id !== 'string' || typeof n.displayName !== 'string') continue;
    teams.push({ id: n.id, name: n.displayName, url: typeof n.profileUrl === 'string' ? n.profileUrl : undefined });
  }
  return teams;
}

/**
 * Teams linked to each project, looked up concurrently as the viewer within TEAM_LOOKUP_BUDGET_MS.
 * All or nothing: if any lookup fails or the budget runs out, this throws, and the caller drops every team
 * for this read (a partial team list could suggest a project has no team when its lookup simply failed).
 */
export async function teamsForProjects(projectKeys: string[], budgetMs = TEAM_LOOKUP_BUDGET_MS): Promise<Map<string, GraphTeam[]>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('twg-timeout')), budgetMs);
  });
  try {
    const lists = await Promise.race([Promise.all(projectKeys.map((k) => teamsForProject(k))), deadline]);
    return new Map(projectKeys.map((k, i) => [k, lists[i]]));
  } finally {
    clearTimeout(timer);
  }
}
