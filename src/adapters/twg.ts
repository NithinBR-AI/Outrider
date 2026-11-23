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

/**
 * GraphQL error messages and classifications for the log, at most 200 characters. They name the failing field or
 * the problem, not user data. Added after an ITS lookup failed on the demo site with no detail (2026-11-23).
 */
function describeErrors(errors: unknown[]): string {
  const parts = errors.slice(0, 2).map((e) => {
    const o = e && typeof e === 'object' ? (e as { message?: unknown; extensions?: { classification?: unknown; statusCode?: unknown } }) : {};
    const message = typeof o.message === 'string' ? o.message : 'no message';
    const kind = [o.extensions?.classification, o.extensions?.statusCode].filter((x) => typeof x === 'string' || typeof x === 'number').join(' ');
    return kind ? `${message} (${kind})` : message;
  });
  return parts.join('; ').replace(/\s+/g, ' ').slice(0, 200);
}

// Teamwork Graph on Forge demo sites intermittently refuses a valid read with HTTP 200 and this error, for the
// same user, query and project, even within one second (seen on this demo site on 2026-11-23, and reported at
// community.developer.atlassian.com/t/103690 with about 30% of reads succeeding). Only this error is retried;
// TEAM_LOOKUP_BUDGET_MS still bounds the whole read.
// Tries are spaced out: back-to-back tries were refused together on the demo site (2026-11-23), while reads a
// moment apart split between success and refusal. 5 tries with 4 pauses of 300 ms fit inside the 4-second budget
// at the call times seen on the demo site; a lookup still retrying at the deadline stops.
const INTERMITTENT_REFUSAL = /not permitted to query this organization/i;
export const TEAM_LOOKUP_ATTEMPTS = 5;
export const TEAM_RETRY_DELAY_MS = 300;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isIntermittentRefusal = (errors: unknown[]): boolean =>
  errors.some((e) => !!e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' && INTERMITTENT_REFUSAL.test((e as { message: string }).message));

/** Teams linked to one Jira project, as the viewer. Throws a short code on any failure. */
async function teamsForProject(projectKey: string, retryDelayMs: number, deadlineAt: number): Promise<GraphTeam[]> {
  const ari = await spaceAri(projectKey);
  let body: TeamsResponse = {};
  for (let attempt = 1; attempt <= TEAM_LOOKUP_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      // Not worth another try if the pause would end after the deadline: the read has given up by then.
      if (Date.now() + retryDelayMs >= deadlineAt) break;
      await pause(retryDelayMs);
    }
    const res = await api.asUser().requestTeamworkGraph(TEAMS_BY_SPACE, { spaceAri: ari }, 'outrider_teamsBySpace');
    if (!res.ok) throw new Error(`twg-${res.status}`);
    body = (await res.json()) as TeamsResponse;
    if (!body.errors || body.errors.length === 0 || !isIntermittentRefusal(body.errors)) break;
  }
  if (body.errors && body.errors.length > 0) throw new Error(`twg-query-error: ${describeErrors(body.errors)}`);
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

/** Teams per project that answered, and the projects whose lookup failed or ran out of time, with why. */
export type TeamLookup = { teams: Map<string, GraphTeam[]>; failed: { projectKey: string; error: string }[] };

/**
 * Teams linked to each project, looked up concurrently as the viewer within TEAM_LOOKUP_BUDGET_MS. Each project
 * succeeds or fails on its own (a lookup still running at the deadline fails with twg-timeout), so one refused
 * project no longer hides the teams of another. Never throws. The caller says when some projects could not be
 * checked, so a missing team is never presented as "no team linked".
 */
export async function teamsForProjects(projectKeys: string[], budgetMs = TEAM_LOOKUP_BUDGET_MS, retryDelayMs = TEAM_RETRY_DELAY_MS): Promise<TeamLookup> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadlineAt = Date.now() + budgetMs;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('twg-timeout')), budgetMs);
  });
  try {
    const settled = await Promise.allSettled(projectKeys.map((k) => Promise.race([teamsForProject(k, retryDelayMs, deadlineAt), deadline])));
    const out: TeamLookup = { teams: new Map(), failed: [] };
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') out.teams.set(projectKeys[i], r.value);
      else out.failed.push({ projectKey: projectKeys[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    });
    return out;
  } finally {
    clearTimeout(timer);
  }
}
