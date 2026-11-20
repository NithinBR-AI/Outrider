// Jira adapter: fetches tickets and retrieves incident and resolution candidates.
//
// Build-time retrieval runs as the app (asApp). This only decides what goes into the shared,
// unfiltered bundle. Serving that bundle to a viewer requires read-time authorization
// (spec §16), which is added in step 6c. Until then, deploy to development only.
import api, { route } from '@forge/api';
import { Incident, Resolution, SourceRef, Ticket } from '../domain/types';
import { adfToText, excerpt, extractKeywords, keywordOverlap, mapIncidentStatus, pickResolutionComment, TicketKeywords } from '../domain/extract';
import { incidentComponents, rank, resolutionComponents } from '../domain/score';

// ---- Configuration (verified against the demo site, see outrider-seed/README.md) ----

// Projects searched for incidents and past resolutions. Incidents mostly live in ITO.
export const SOURCE_PROJECTS = ['ITS', 'ITO'];
// Custom field IDs on this site.
const FIELD_REQUEST_TYPE = 'customfield_10010';
const FIELD_AFFECTED_SERVICES = 'customfield_10039';
// How far back to look. Resolved incidents older than this are not "recent".
const RECENT_INCIDENT_DAYS = 30;
const RESOLUTION_LOOKBACK_DAYS = 365;
// How many candidates to pull from Jira before scoring in the app. Jira text search is
// unreliable on the demo site, so we pull a bounded candidate set and score it ourselves.
const INCIDENT_CANDIDATES = 100;
const RESOLUTION_CANDIDATES = 100;
const SAME_REQUESTER_CANDIDATES = 20;
// Only the best few resolution candidates get their comments fetched (one request each).
const RESOLUTION_COMMENT_FETCHES = 8;
// Minimum weighted keyword overlap for a "same-symptom" match.
const MIN_SYMPTOM_OVERLAP = 0.2;
// A same-requester match still needs some symptom overlap; the requester alone is not relevance.
const MIN_REQUESTER_OVERLAP = 0.05;
// Candidates kept per section from retrieval. The bundle-wide limit (MAX_BUNDLE_CANDIDATES) and the
// display limit (MAX_DISPLAY_ITEMS_PER_SECTION) are applied later; the three limits are separate (§9.6).
export const MAX_SECTION_CANDIDATES = 10;
// Stored text lengths. Only excerpts are persisted, never full source text (spec §7.3).
const INCIDENT_EXCERPT_CHARS = 300;
const RESOLUTION_EXCERPT_CHARS = 600;

// ---- Raw Jira shapes (only the fields we read) ----

type JiraUser = { accountId: string; displayName?: string; accountType?: string };
type JiraIssue = {
  id: string;
  key: string;
  self: string;
  fields: {
    summary?: string;
    description?: unknown;
    reporter?: JiraUser | null;
    project?: { key: string };
    issuetype?: { name: string };
    priority?: { name: string } | null;
    labels?: string[];
    status?: { name: string; statusCategory?: { key: string } };
    created?: string;
    updated?: string;
    resolutiondate?: string | null;
    [field: string]: unknown;
  };
};
type JiraComment = { author?: JiraUser; body?: unknown; jsdPublic?: boolean; created?: string };

// ---- HTTP helpers ----

async function jiraGet<T>(path: ReturnType<typeof route>): Promise<T> {
  const res = await api.asApp().requestJira(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`jira-get-${res.status}`);
  return (await res.json()) as T;
}

async function searchJql(jql: string, fields: string[], maxResults: number): Promise<JiraIssue[]> {
  const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields, maxResults }),
  });
  if (!res.ok) throw new Error(`jira-search-${res.status}`);
  const data = (await res.json()) as { issues?: JiraIssue[] };
  return data.issues ?? [];
}

// JQL string literals: escape backslashes and double quotes.
function jqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function browseUrl(issue: JiraIssue): string {
  return `${new URL(issue.self).origin}/browse/${issue.key}`;
}

function toSourceRef(issue: JiraIssue): SourceRef {
  return {
    kind: 'jira-issue',
    id: issue.key,
    url: browseUrl(issue),
    title: issue.fields.summary ?? issue.key,
    updatedAt: issue.fields.updated ?? '',
  };
}

function serviceIdsOf(issue: JiraIssue): string[] {
  const raw = issue.fields[FIELD_AFFECTED_SERVICES];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => (s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string' ? (s as { id: string }).id : ''))
    .filter((id) => id.length > 0);
}

function candidateText(issue: JiraIssue): string {
  return `${issue.fields.summary ?? ''} ${adfToText(issue.fields.description)}`;
}

/**
 * overlap decides whether a candidate qualifies at all, and stands in for semantic similarity in
 * the ranking (domain/score.ts). A shared Affected service is only a ranking tie-breaker: one service
 * often covers unrelated problems (on the demo site, database and VPN incidents share
 * "Infrastructure Services").
 */
function match(keywords: TicketKeywords, text: string, ticket: Ticket, issue: JiraIssue): { overlap: number; sharedService: boolean } {
  return {
    overlap: keywordOverlap(keywords, text),
    sharedService: serviceIdsOf(issue).some((id) => ticket.serviceIds.includes(id)),
  };
}

const sourceKey = (issue: JiraIssue) => `jira-issue:${issue.key}`;

const CANDIDATE_FIELDS = ['summary', 'description', 'status', 'created', 'updated', 'resolutiondate', 'reporter', 'issuetype', FIELD_AFFECTED_SERVICES];

// ---- Read-time authorization (spec §16) ----

// Jira issue key shape. Anything else is never sent to Jira and counts as not visible.
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
// Keys per visibility search. A bundle holds at most 20 sources plus the ticket, so one call is typical.
const VISIBILITY_BATCH = 50;

/**
 * Returns the subset of issue keys the current viewer can see, using one JQL search per batch run AS
 * THE VIEWER (asUser), never as the app. Verified on the demo site: issues the viewer cannot see,
 * deleted issues and keys in unknown projects are all silently left out, so the result never reveals
 * which of those cases applied. Throws on any failure; callers must treat that as "not visible" (§16.5).
 */
export async function visibleIssueKeys(keys: string[]): Promise<Set<string>> {
  const valid = [...new Set(keys)].filter((k) => ISSUE_KEY.test(k));
  const visible = new Set<string>();
  for (let i = 0; i < valid.length; i += VISIBILITY_BATCH) {
    const batch = valid.slice(i, i + VISIBILITY_BATCH);
    const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql: `key in (${batch.join(', ')})`, fields: ['key'], maxResults: batch.length }),
    });
    if (!res.ok) throw new Error(`jira-visibility-${res.status}`);
    const data = (await res.json()) as { issues?: { key: string }[] };
    for (const issue of data.issues ?? []) visible.add(issue.key);
  }
  return visible;
}

// ---- Public API ----

/** Fetches the current state of a ticket (spec §8.1). */
export async function getTicket(ticketKey: string): Promise<Ticket> {
  const fields = ['summary', 'description', 'reporter', 'project', 'priority', 'labels', 'status', 'updated', FIELD_REQUEST_TYPE, FIELD_AFFECTED_SERVICES].join(',');
  const issue = await jiraGet<JiraIssue>(route`/rest/api/3/issue/${ticketKey}?fields=${fields}`);
  const requestType = issue.fields[FIELD_REQUEST_TYPE] as { requestType?: { id?: string } } | null | undefined;
  return {
    key: issue.key,
    projectKey: issue.fields.project?.key ?? issue.key.split('-')[0],
    summary: issue.fields.summary ?? '',
    description: adfToText(issue.fields.description),
    requester: issue.fields.reporter ? { accountId: issue.fields.reporter.accountId, displayName: issue.fields.reporter.displayName } : undefined,
    requestTypeId: requestType?.requestType?.id,
    priority: issue.fields.priority?.name,
    labels: issue.fields.labels ?? [],
    serviceIds: serviceIdsOf(issue),
    status: issue.fields.status?.name ?? '',
    updatedAt: issue.fields.updated ?? '',
  };
}

/** Active incidents and recently resolved incidents related to the ticket, ranked per spec §9. */
export async function searchIncidents(ticket: Ticket, now: Date = new Date()): Promise<Incident[]> {
  const projects = SOURCE_PROJECTS.join(', ');
  const jql =
    `project in (${projects}) AND issuetype = "[System] Incident" AND key != ${jqlString(ticket.key)} ` +
    `AND (statusCategory != Done OR resolved >= -${RECENT_INCIDENT_DAYS}d) ORDER BY created DESC`;
  const issues = await searchJql(jql, CANDIDATE_FIELDS, INCIDENT_CANDIDATES);
  const keywords = extractKeywords(ticket.summary, ticket.description);

  const qualified: { issue: JiraIssue; status: Incident['status']; overlap: number; sharedService: boolean }[] = [];
  for (const issue of issues) {
    const status = mapIncidentStatus(issue.fields.status?.name ?? '', issue.fields.status?.statusCategory?.key ?? '');
    const m = match(keywords, candidateText(issue), ticket, issue);
    if (status !== null && m.overlap >= MIN_SYMPTOM_OVERLAP) qualified.push({ issue, status, ...m });
  }

  return rank(
    qualified.map((c) => ({
      item: c,
      sourceKey: sourceKey(c.issue),
      sharedService: c.sharedService,
      components: incidentComponents(c.status, c.issue.fields.created, c.overlap, now),
    })),
  )
    .slice(0, MAX_SECTION_CANDIDATES)
    .map(({ item: c }) => ({
      source: toSourceRef(c.issue),
      status: c.status,
      summary: excerpt(adfToText(c.issue.fields.description), INCIDENT_EXCERPT_CHARS),
      relevance: c.overlap,
      startedAt: c.issue.fields.created,
    }));
}

/** Previously resolved tickets with similar symptoms or the same requester, ranked per spec §9. */
export async function searchResolutions(ticket: Ticket, now: Date = new Date()): Promise<Resolution[]> {
  const projects = SOURCE_PROJECTS.join(', ');
  const base =
    `project in (${projects}) AND statusCategory = Done AND status != Cancelled ` +
    `AND resolved >= -${RESOLUTION_LOOKBACK_DAYS}d AND key != ${jqlString(ticket.key)}`;
  const requesterId = ticket.requester?.accountId;

  const [bySymptom, byRequester] = await Promise.all([
    searchJql(`${base} ORDER BY resolved DESC`, CANDIDATE_FIELDS, RESOLUTION_CANDIDATES),
    requesterId
      ? searchJql(`${base} AND reporter = ${jqlString(requesterId)} ORDER BY resolved DESC`, CANDIDATE_FIELDS, SAME_REQUESTER_CANDIDATES)
      : Promise.resolve([] as JiraIssue[]),
  ]);

  // Merge the two candidate sets, keyed by issue key.
  const merged = new Map<string, JiraIssue>();
  for (const issue of [...bySymptom, ...byRequester]) merged.set(issue.key, issue);
  const keywords = extractKeywords(ticket.summary, ticket.description);

  // First pass: score on summary and description. Keep candidates with some symptom overlap, plus
  // same-requester candidates, whose overlap may only appear in the resolution comment.
  const isSameRequester = (issue: JiraIssue) => !!requesterId && issue.fields.reporter?.accountId === requesterId;
  // This pass only chooses which comments to fetch, so a simple overlap ordering is enough.
  const firstPass = [...merged.values()]
    .map((issue) => ({ issue, ...match(keywords, candidateText(issue), ticket, issue) }))
    .filter((c) => c.overlap > 0 || isSameRequester(c.issue))
    .sort((a, b) => b.overlap - a.overlap || Number(b.sharedService) - Number(a.sharedService) || a.issue.key.localeCompare(b.issue.key))
    .slice(0, RESOLUTION_COMMENT_FETCHES);

  // Second pass: fetch the resolution text (comments) for the best candidates and re-score.
  const withText = await Promise.all(
    firstPass.map(async ({ issue }) => {
      // One failed comment fetch drops that candidate only, not the whole section.
      const resolutionText = await getResolutionText(issue).catch(() => '');
      return { issue, resolutionText, ...match(keywords, `${candidateText(issue)} ${resolutionText}`, ticket, issue) };
    }),
  );

  const qualified = withText
    .filter((c) => c.resolutionText.length > 0)
    .map((c) => ({ ...c, sameRequester: isSameRequester(c.issue), sameSymptom: c.overlap >= MIN_SYMPTOM_OVERLAP }))
    .filter((c) => c.sameSymptom || (c.sameRequester && c.overlap >= MIN_REQUESTER_OVERLAP));

  return rank(
    qualified.map((c) => {
      const resolvedAt = c.issue.fields.resolutiondate ?? c.issue.fields.updated ?? '';
      return { item: { ...c, resolvedAt }, sourceKey: sourceKey(c.issue), sharedService: c.sharedService, components: resolutionComponents(resolvedAt, c.overlap, now) };
    }),
  )
    .slice(0, MAX_SECTION_CANDIDATES)
    .map(({ item: c }) => ({
      source: toSourceRef(c.issue),
      resolvedAt: c.resolvedAt,
      resolutionText: excerpt(c.resolutionText, RESOLUTION_EXCERPT_CHARS),
      matchReason: c.sameRequester && c.sameSymptom ? 'both' : c.sameRequester ? 'same-requester' : 'same-symptom',
      relevance: c.overlap,
    }));
}

/**
 * The fix for a resolved ticket lives in its comments, not in the resolution field (which is
 * only a category such as "Done"). See pickResolutionComment for how the fix comment is chosen.
 * Only public comments are eligible until read-time authorization exists (step 6c).
 */
async function getResolutionText(issue: JiraIssue): Promise<string> {
  const data = await jiraGet<{ comments?: JiraComment[] }>(
    route`/rest/api/3/issue/${issue.key}/comment?orderBy=-created&maxResults=20`,
  );
  const reporterId = issue.fields.reporter?.accountId;
  return pickResolutionComment(
    (data.comments ?? []).map((c) => ({
      text: adfToText(c.body),
      isPublic: c.jsdPublic !== false,
      isHumanAgent: c.author?.accountType === 'atlassian',
      byRequester: !!reporterId && c.author?.accountId === reporterId,
    })),
  );
}
