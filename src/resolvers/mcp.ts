// Action handlers for the MCP tools (manifest: actions get-ticket-context, find-related-incidents,
// find-similar-resolutions).
//
// Forge passes (payload, context). payload holds the inputs the agent filled in, plus page context
// when called from an issue view. Inputs only identify the target; they never authorize it (§15.5,
// and the Rovo action docs). The caller is read from context.principal.accountId, verified on the
// demo site to be the real invoking user.
import {
  findRelatedIncidents as findRelatedIncidentsTool,
  FindIncidentsResult,
  FindQuery,
  FindResolutionsResult,
  findSimilarResolutions as findSimilarResolutionsTool,
  getTicketContext as getTicketContextTool,
  GetTicketContextResult,
} from '../mcp/tools';
import { cleanQueryText } from '../domain/query';

// Jira issue key shape; anything else is rejected before it reaches Jira.
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

type InvalidRequest = { status: 'invalid-request'; message: string };

/** Picks the target ticket: the agent's input if it is a valid key, else the issue the user is viewing. */
export function resolveTicketKey(payload: Record<string, unknown>): string | undefined {
  const input = typeof payload.ticketKey === 'string' ? payload.ticketKey.trim().toUpperCase() : undefined;
  if (input && ISSUE_KEY.test(input)) return input;
  const jira = (payload.context as { jira?: { issueKey?: unknown } } | undefined)?.jira;
  const fromPage = typeof jira?.issueKey === 'string' ? jira.issueKey.trim().toUpperCase() : undefined;
  return fromPage && ISSUE_KEY.test(fromPage) ? fromPage : undefined;
}

const NO_CALLER: InvalidRequest = { status: 'invalid-request', message: 'This tool needs a signed-in user.' };

/** The authenticated caller, or undefined. Never falls back to the app's identity (§16.2). */
function callerOf(context?: Record<string, unknown>): string | undefined {
  const id = (context as { principal?: { accountId?: unknown } } | undefined)?.principal?.accountId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export async function getTicketContext(
  payload: Record<string, unknown>,
  context?: Record<string, unknown>,
): Promise<GetTicketContextResult | InvalidRequest> {
  const callerAccountId = callerOf(context);
  if (!callerAccountId) return NO_CALLER;
  const ticketKey = resolveTicketKey(payload ?? {});
  if (!ticketKey) {
    return { status: 'invalid-request', message: 'Provide a Jira issue key such as ITS-123.' };
  }
  return getTicketContextTool(ticketKey, callerAccountId);
}

/**
 * Inputs for the find-* tools (§15.2, §15.3): ticketKey and/or free text, at least one.
 * - An explicit ticketKey must be a valid issue key; a malformed one is rejected, not silently dropped.
 * - The issue the user is viewing is used only when no input is given at all, so "incidents about VPN"
 *   asked while on ITS-6265 searches for VPN, not ITS-6265.
 */
export function resolveFindQuery(payload: Record<string, unknown>, textField: 'keywords' | 'description'): FindQuery | InvalidRequest {
  const text = cleanQueryText(payload[textField]);
  const rawKey = typeof payload.ticketKey === 'string' ? payload.ticketKey.trim() : '';
  if (rawKey) {
    const ticketKey = rawKey.toUpperCase();
    if (!ISSUE_KEY.test(ticketKey)) return { status: 'invalid-request', message: 'ticketKey must be a Jira issue key such as ITS-123.' };
    return { ticketKey, text };
  }
  if (text) return { text };
  const fromPage = resolveTicketKey({ context: payload.context });
  if (fromPage) return { ticketKey: fromPage };
  return { status: 'invalid-request', message: `Provide a Jira issue key such as ITS-123, or ${textField}.` };
}

export async function findRelatedIncidents(payload: Record<string, unknown>, context?: Record<string, unknown>): Promise<FindIncidentsResult | InvalidRequest> {
  if (!callerOf(context)) return NO_CALLER;
  const query = resolveFindQuery(payload ?? {}, 'keywords');
  return 'status' in query ? query : findRelatedIncidentsTool(query);
}

export async function findSimilarResolutions(payload: Record<string, unknown>, context?: Record<string, unknown>): Promise<FindResolutionsResult | InvalidRequest> {
  if (!callerOf(context)) return NO_CALLER;
  const query = resolveFindQuery(payload ?? {}, 'description');
  return 'status' in query ? query : findSimilarResolutionsTool(query);
}
