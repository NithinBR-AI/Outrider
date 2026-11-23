// Builds a viewer's copy of a stored bundle. Shared by the panel resolver and the MCP tools, so both
// read paths apply exactly the same rules (spec §15.5: thin handlers over shared authorization logic).
import { liveSourceTexts } from '../adapters/jira';
import { liveArticleTexts } from '../adapters/confluence';
import { AUTH_CONFLUENCE_CHECK_FAILED, bundlePageIds, citedJiraKeys, filterBundleForViewer, withFailure, withVerifiedSummary } from '../domain/authorize';
import { TeamLookup, teamsForProjects } from '../adapters/twg';
import { ContextBundle, ViewerBundle } from '../domain/types';
import { LiveSource } from '../domain/verify';
import { incidentProjects, mergeTeams, teamsFailure } from '../domain/teams';
import { MAX_DISPLAY_ITEMS_PER_SECTION } from '../domain/score';
import { signalsForTicket } from './signals';

/**
 * Sources filtered for the viewer, and the stored summary verified against the cited sources' live text,
 * fetched AS THE VIEWER (§13.2 step 3).
 * - Jira: `visible` holds the issue keys the viewer can see (or null if that check failed); cited issues'
 *   live text comes from one JQL search as the viewer.
 * - Confluence: one batch page fetch as the viewer covers both the articles and the pages the summary
 *   cites. It decides which pages the viewer may see and gives their current text. If it fails, every
 *   article and every claim citing a page is dropped, and the response records auth:confluence-check-failed.
 * Anything a fetch does not return is omitted.
 */
export async function viewerBundle(stored: ContextBundle, visible: Set<string> | null): Promise<ViewerBundle> {
  const pageIds = bundlePageIds(stored);
  let pages: Map<string, LiveSource> | null = new Map();
  if (pageIds.length > 0) {
    try {
      pages = await liveArticleTexts(pageIds);
    } catch (err) {
      console.error(`Confluence visibility check failed for ${stored.ticketKey}`, err);
      pages = null;
    }
  }
  const visiblePages = pages === null ? null : new Set([...pages.values()].map((p) => p.ref.id));
  let filtered = filterBundleForViewer(stored, visible, visiblePages);
  if (pages === null && pageIds.length > 0) filtered = withFailure(filtered, AUTH_CONFLUENCE_CHECK_FAILED);

  const keys = citedJiraKeys(stored.summary);
  let jira: Map<string, LiveSource> | null = new Map();
  if (keys.length > 0) {
    try {
      jira = await liveSourceTexts(keys);
    } catch (err) {
      console.error(`live source fetch for verification failed for ${stored.ticketKey}`, err);
      jira = null;
    }
  }
  const live = jira === null ? null : new Map([...jira, ...(pages ?? new Map())]);
  return withSignals(await withTeams(withVerifiedSummary(filtered, stored.summary, live)));
}

/**
 * Adds the teams involved (step 11): teams linked to the projects of the related incidents the viewer can
 * see, among those the panel shows. Looked up as the viewer at read time; no incidents means no call. Each
 * project counts on its own: teams from projects that answered are shown; if some did not, the response records
 * twg:partial, and if none did, twg:unavailable with no teams. Nothing else changes.
 */
async function withTeams(viewer: ViewerBundle): Promise<ViewerBundle> {
  const projects = incidentProjects(viewer.incidents.slice(0, MAX_DISPLAY_ITEMS_PER_SECTION));
  if (projects.length === 0) return { ...viewer, teams: [] };
  let lookup: TeamLookup;
  try {
    lookup = await teamsForProjects(projects.map((p) => p.projectKey));
  } catch (err) {
    lookup = { teams: new Map(), failed: projects.map((p) => ({ projectKey: p.projectKey, error: (err as Error).message })) };
  }
  for (const f of lookup.failed) console.error(`Teamwork Graph team lookup failed for ${viewer.ticketKey} (${f.projectKey}): ${f.error}`);
  const answered = projects.filter((p) => lookup.teams.has(p.projectKey));
  const teams = mergeTeams(answered.map((p) => ({ ...p, teams: lookup.teams.get(p.projectKey) ?? [] })));
  const failure = teamsFailure(projects.length, projects.length - answered.length);
  return { ...(failure ? withFailure(viewer, failure) : viewer), teams };
}

/**
 * Adds the emerging-incident signals that include this ticket (step 13), filtered for the viewer at read time
 * (resolvers/signals.ts). A failed check shows no signal and marks the response partial; nothing else changes.
 */
async function withSignals(viewer: ViewerBundle): Promise<ViewerBundle> {
  const { signals, failure } = await signalsForTicket(viewer.ticketKey);
  return { ...(failure ? withFailure(viewer, failure) : viewer), emergingSignals: signals };
}
