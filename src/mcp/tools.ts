// MCP tool logic (spec §15). Thin wrappers over the shared retrieval and authorization code.
//
// get-ticket-context, in the order spec §15.1 makes mandatory:
// 1. Authorize the caller for the ticket, AS THE CALLER (asUser), before anything else. A caller who
//    cannot see the ticket, or a failed check, gets the same "not accessible" response a nonexistent
//    ticket gets: no build is queued, no pending response, nothing about whether a bundle exists.
// 2. If no bundle exists: queue a build (unless one is already in flight) and return PendingContext.
// 3. If a bundle exists: return it filtered for this caller, exactly like the panel (§16.2, §16.4),
//    including the summary verified for this caller against live source text (§13.6).
//
// Caller identity is verified on the demo site (6c-3): Rovo/MCP invocations carry the caller in
// context.principal.accountId, and asUser() inside the action runs with that caller's permissions.
import { getTicket, searchIncidents, searchResolutions, visibleIssueKeys } from '../adapters/jira';
import { getBundle, getStatus } from '../adapters/storage';
import { AUTH_JIRA_CHECK_FAILED, bundleSourceKeys } from '../domain/authorize';
import { MAX_TOOL_RESULTS, textQuery, withHint } from '../domain/query';
import { isBundleTicket, NOT_SET_UP_MESSAGE, RetrievalSettings, SiteSettings } from '../domain/settings';
import { getSettings } from '../adapters/settings';
import { Incident, PendingContext, Resolution, Ticket, ViewerBundle } from '../domain/types';
import { viewerBundle } from '../resolvers/viewerContext';
import { signalsForProjects } from '../resolvers/signals';
import { ClusterSignal } from '../domain/cluster';
import { enqueueTicketBuild } from '../pipeline/enqueue';

/** Returned when the caller may not see the ticket, or it does not exist. The two are indistinguishable. */
export type TicketNotAccessible = {
  status: 'not-accessible';
  ticketKey: string;
  message: string;
};

/**
 * Returned when the site has no settings, or (get-ticket-context) the ticket's project does not get context
 * (Phase 5.5). Only after the ticket gate passes, so it never tells an unauthorized caller anything.
 */
export type NotSetUp = { status: 'not-set-up'; message: string };
const NOT_SET_UP: NotSetUp = { status: 'not-set-up', message: NOT_SET_UP_MESSAGE };

/**
 * The viewer-filtered bundle as MCP callers receive it. buildId and ticketFingerprint are internal
 * bookkeeping (build ownership, stale-build detection) and only add noise for an AI agent, so they are
 * left out. builtAt stays so the agent can cite freshness; partial and failures stay so it can say when
 * sources were unavailable. The stored bundle and the panel response are unchanged.
 */
// Notes for AI agents. An agent describes whatever it receives, and once described a claim the verifier
// rejected as "mentioned in some notes". These notes make the meaning of each list impossible to miss.
export const CLAIMS_NOTE =
  'Each claim shares a verbatim span with its cited source (see span and source). This is a text match, not proof that the claim is true.';
// Matches the panel label "Removed: couldn't match this to the source's wording". A rejected claim may be
// unsupported, or a true statement the model reworded too far (spec §13.2 step 6a), so the note must not
// say the source lacks it.
export const UNSUPPORTED_CLAIM_NOTE =
  "Generated claim whose wording could not be matched to its cited source, so Outrider does not show it as supported. Do not present it as a fact or as something a source says; if it matters, check the sources directly.";

// Step 11. Verified on the demo site: without it, a Rovo agent turned "Platform Support, linked to the ITO project"
// into "Platform Support is currently investigating", and with a first note still into "Responsible Team". The link is an
// Atlassian Teams setting on the project only.
export const TEAMS_NOTE =
  'Each team is linked in Atlassian Teams to the Jira project where a related incident is tracked (see evidence). This does not mean the team is assigned to, responsible for, or working on the incident. Describe it as a team linked to that project, not as the responsible, owning or investigating team.';
/** The verified summary as MCP callers receive it. */
export type McpSummary = {
  claimsNote: string;
  claims: NonNullable<ViewerBundle['summary']>['claims'];
  // The panel calls these "rejected". For agents they are named and annotated as unsupported, so they
  // cannot be mistaken for disputed or partially sourced information.
  unsupportedClaims: { text: string; reason: 'no-matching-span'; note: string }[];
  origin?: NonNullable<ViewerBundle['summary']>['origin'];
};

export type McpContextBundle = Omit<ViewerBundle, 'buildId' | 'ticketFingerprint' | 'summary'> & { summary?: McpSummary; teamsNote?: string };

export type GetTicketContextResult = McpContextBundle | PendingContext | TicketNotAccessible | NotSetUp;

/** Removes internal bookkeeping fields and annotates the verified summary for agents. */
export function toMcpBundle(bundle: ViewerBundle): McpContextBundle {
  const { buildId: _buildId, ticketFingerprint: _fingerprint, summary, ...base } = bundle;
  const rest: McpContextBundle = (base.teams ?? []).length > 0 ? { ...base, teamsNote: TEAMS_NOTE } : base;
  if (!summary) return rest;
  return {
    ...rest,
    summary: {
      claimsNote: CLAIMS_NOTE,
      claims: summary.claims,
      unsupportedClaims: summary.rejected.map((r) => ({ text: r.text, reason: r.reason, note: UNSUPPORTED_CLAIM_NOTE })),
      origin: summary.origin,
    },
  };
}

export const NOT_ACCESSIBLE_MESSAGE = 'The ticket was not found or you do not have access to it.';
export const PENDING_MESSAGE = 'Context for this ticket is being prepared. Ask again in a minute.';

export async function getTicketContext(ticketKey: string): Promise<GetTicketContextResult> {
  const notAccessible: TicketNotAccessible = { status: 'not-accessible', ticketKey, message: NOT_ACCESSIBLE_MESSAGE };

  // 1. Authorization gate, before any read of stored state or any side effect.
  let ticketVisible: boolean;
  try {
    ticketVisible = (await visibleIssueKeys([ticketKey])).has(ticketKey);
  } catch (err) {
    console.error(`MCP visibility check failed for ${ticketKey}`, err);
    ticketVisible = false; // Could not verify means not authorized (§16.5).
  }
  if (!ticketVisible) return notAccessible;

  // Not set up for this project: say so instead of queueing a build that would do nothing.
  if (!isBundleTicket(await getSettings(), ticketKey)) return NOT_SET_UP;

  // 2. No bundle yet: report the build in flight, or queue one.
  const stored = await getBundle(ticketKey);
  if (!stored) {
    const status = await getStatus(ticketKey);
    if (status && (status.status === 'queued' || status.status === 'building')) {
      return { status: 'pending', ticketKey, buildId: status.buildId, requestedAt: status.requestedAt, message: PENDING_MESSAGE };
    }
    const { buildId, requestedAt } = await enqueueTicketBuild(ticketKey, { source: 'unknown' });
    return { status: 'pending', ticketKey, buildId, requestedAt, message: PENDING_MESSAGE };
  }

  // 3. Filter the stored bundle for this caller. A failed source check drops every source (§16.5).
  let visible: Set<string> | null;
  try {
    visible = await visibleIssueKeys(bundleSourceKeys(stored));
    visible.add(ticketKey);
  } catch (err) {
    console.error(`MCP source visibility check failed for ${ticketKey}`, err);
    visible = null;
  }
  return toMcpBundle(await viewerBundle(stored, visible));
}

// ---- find-related-incidents and find-similar-resolutions (spec §15.2, §15.3) ----
//
// Live retrieval on every call, never the stored bundle: these tools are for an agent investigating now,
// including tickets that never get a bundle (for example ITO incidents). Order:
// 1. If a ticket is named: authorize the caller for it, AS THE CALLER, before anything else. Not visible,
//    nonexistent, or a failed check all get the same TicketNotAccessible answer.
// 2. Retrieve and rank as the app, with the same engine as the bundle (adapters/jira.ts). The ticket wins;
//    free text is only a hint appended to it (domain/query.ts). Text alone gives a symptom-only query.
// 3. Keep only results the caller can see (one JQL search as the caller), then cap at MAX_TOOL_RESULTS.
//    Hidden results leave no trace. A failed check returns nothing, marked partial, never unfiltered items.
//
// Deliberate extension of §15.2/§15.3, agreed for agent usability: results come wrapped as { incidents } or
// { resolutions }, with partial and failures, instead of a bare array. A wrapper lets an agent tell "no
// results" from "no access" (TicketNotAccessible) and from "could not check" (partial).

export type FindQuery = { ticketKey?: string; text?: string };
export type FindIncidentsResult = { incidents: Incident[]; partial: boolean; failures: string[] } | TicketNotAccessible | NotSetUp;
export type FindResolutionsResult = { resolutions: Resolution[]; partial: boolean; failures: string[] } | TicketNotAccessible | NotSetUp;

// Ticket has its own status field (the Jira status), so "'status' in x" cannot tell a query ticket from these.
const isRefusal = (x: object): x is TicketNotAccessible | NotSetUp => {
  const status = (x as { status?: unknown }).status;
  return (status === 'not-accessible' || status === 'not-set-up') && 'message' in x;
};

/**
 * The query ticket for a find-* call. Order: the ticket gate (if a ticket is named), then the settings check,
 * then the ticket read. The find tools search any ticket the caller can see, so they only need settings
 * to exist, not the ticket's project to be a bundle project.
 */
async function queryFor(query: FindQuery, settings: SiteSettings | undefined): Promise<Ticket | TicketNotAccessible | NotSetUp> {
  if (!query.ticketKey) return settings ? textQuery(query.text ?? '') : NOT_SET_UP;
  const notAccessible: TicketNotAccessible = { status: 'not-accessible', ticketKey: query.ticketKey, message: NOT_ACCESSIBLE_MESSAGE };
  try {
    if (!(await visibleIssueKeys([query.ticketKey])).has(query.ticketKey)) return notAccessible;
    if (!settings) return NOT_SET_UP;
    return withHint(await getTicket(query.ticketKey, settings), query.text);
  } catch (err) {
    // Could not verify, or the ticket vanished after the check: not accessible (§16.5).
    console.error(`MCP find: ticket check failed for ${query.ticketKey}`, err);
    return notAccessible;
  }
}

/** Retrieves as the app, then keeps what the caller can see, capped. Failures return nothing, marked partial. */
async function findFor<T extends { source: { id: string } }>(
  query: FindQuery,
  search: (ticket: Ticket, settings: RetrievalSettings) => Promise<T[]>,
  sourceFailure: string,
): Promise<{ items: T[]; partial: boolean; failures: string[] } | TicketNotAccessible | NotSetUp> {
  const settings = await getSettings();
  const ticket = await queryFor(query, settings);
  if (isRefusal(ticket)) return ticket;
  let found: T[];
  try {
    found = await search(ticket, settings!);
  } catch (err) {
    console.error(`MCP find: ${sourceFailure} failed`, err);
    return { items: [], partial: true, failures: [sourceFailure] };
  }
  if (found.length === 0) return { items: [], partial: false, failures: [] };
  try {
    const visible = await visibleIssueKeys(found.map((f) => f.source.id));
    return { items: found.filter((f) => visible.has(f.source.id)).slice(0, MAX_TOOL_RESULTS), partial: false, failures: [] };
  } catch (err) {
    console.error('MCP find: result visibility check failed', err);
    return { items: [], partial: true, failures: [AUTH_JIRA_CHECK_FAILED] };
  }
}

export async function findRelatedIncidents(query: FindQuery): Promise<FindIncidentsResult> {
  const r = await findFor(query, (t, s) => searchIncidents(t, s), 'jira-incidents');
  return isRefusal(r) ? r : { incidents: r.items, partial: r.partial, failures: r.failures };
}

export async function findSimilarResolutions(query: FindQuery): Promise<FindResolutionsResult> {
  const r = await findFor(query, (t, s) => searchResolutions(t, s), 'jira-resolutions');
  return isRefusal(r) ? r : { resolutions: r.items, partial: r.partial, failures: r.failures };
}

// ---- get-emerging-incidents (step 13, spec §14.9, §15) ----
//
// Active emerging-incident signals in the projects that get context, filtered for the caller exactly like the
// panel (resolvers/signals.ts): a signal is returned only if the caller can see at least its threshold of
// requests, and only with those requests. Advisory: a signal is never an incident (§14.10).

// Verified via Rovo for teams that an agent overstates what an advisory record means; the same applies here.
export const SIGNALS_NOTE =
  'Each signal means several open requests share the same structured service and/or component within a short window. state "confirmed" only means both the service and the component match on every listed request; "uncertain" means one of them is missing on at least one request. Neither says how likely an incident is. It is advisory: no incident has been declared or created by Outrider. Recommend investigation; do not say an incident exists or is likely, and do not say one has not been declared "yet".';

export type EmergingIncidentsResult = { signals: ClusterSignal[]; signalsNote?: string; partial: boolean; failures: string[] } | NotSetUp;

/** Signals for one project (if given and set up for context) or for every project that gets context. */
export async function getEmergingIncidents(projectKey?: string): Promise<EmergingIncidentsResult> {
  const settings = await getSettings();
  if (!settings) return NOT_SET_UP;
  if (projectKey && !settings.bundleProjects.includes(projectKey)) return NOT_SET_UP;
  const { signals, failure } = await signalsForProjects(projectKey ? [projectKey] : settings.bundleProjects);
  return { signals, ...(signals.length > 0 ? { signalsNote: SIGNALS_NOTE } : {}), partial: !!failure, failures: failure ? [failure] : [] };
}
