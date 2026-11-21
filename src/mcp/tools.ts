// MCP tool logic (spec §15). Thin wrappers over the shared retrieval and authorization code.
//
// get-ticket-context, in the order spec §15.1 makes mandatory:
// 1. Authorize the caller for the ticket, AS THE CALLER (asUser), before anything else. A caller who
//    cannot see the ticket, or a failed check, gets the same "not accessible" response a nonexistent
//    ticket gets: no build is queued, no pending response, nothing about whether a bundle exists.
// 2. If no bundle exists: queue a build (unless one is already in flight) and return PendingContext.
// 3. If a bundle exists: return it filtered for this caller, exactly like the panel (§16.2, §16.4).
//
// Caller identity is verified on the demo site (6c-3): Rovo/MCP invocations carry the caller in
// context.principal.accountId, and asUser() inside the action runs with that caller's permissions.
import { visibleIssueKeys } from '../adapters/jira';
import { getBundle, getStatus } from '../adapters/storage';
import { bundleSourceKeys, filterBundleForViewer } from '../domain/authorize';
import { ContextBundle, PendingContext } from '../domain/types';
import { enqueueTicketBuild } from '../pipeline/enqueue';

/** Returned when the caller may not see the ticket, or it does not exist. The two are indistinguishable. */
export type TicketNotAccessible = {
  status: 'not-accessible';
  ticketKey: string;
  message: string;
};

/**
 * The viewer-filtered bundle as MCP callers receive it. buildId and ticketFingerprint are internal
 * bookkeeping (build ownership, stale-build detection) and only add noise for an AI agent, so they are
 * left out. builtAt stays so the agent can cite freshness; partial and failures stay so it can say when
 * sources were unavailable. The stored bundle and the panel response are unchanged.
 */
export type McpContextBundle = Omit<ContextBundle, 'buildId' | 'ticketFingerprint'>;

export type GetTicketContextResult = McpContextBundle | PendingContext | TicketNotAccessible;

/** Removes internal bookkeeping fields from a viewer-filtered bundle. */
export function toMcpBundle(bundle: ContextBundle): McpContextBundle {
  const { buildId: _buildId, ticketFingerprint: _fingerprint, ...rest } = bundle;
  return rest;
}

export const NOT_ACCESSIBLE_MESSAGE = 'The ticket was not found or you do not have access to it.';
export const PENDING_MESSAGE = 'Context for this ticket is being prepared. Ask again in a minute.';

export async function getTicketContext(ticketKey: string, callerAccountId: string): Promise<GetTicketContextResult> {
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

  // 2. No bundle yet: report the build in flight, or queue one.
  const stored = await getBundle(ticketKey);
  if (!stored) {
    const status = await getStatus(ticketKey);
    if (status && (status.status === 'queued' || status.status === 'building')) {
      return { status: 'pending', ticketKey, buildId: status.buildId, requestedAt: status.requestedAt, message: PENDING_MESSAGE };
    }
    const { buildId, requestedAt } = await enqueueTicketBuild(ticketKey, { accountId: callerAccountId, source: 'unknown' });
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
  return toMcpBundle(filterBundleForViewer(stored, visible));
}
