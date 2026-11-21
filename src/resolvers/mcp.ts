// Action handler for the get-ticket-context MCP tool (manifest: action get-ticket-context).
//
// Forge passes (payload, context). payload holds the inputs the agent filled in, plus page context
// when called from an issue view. Inputs only identify the target; they never authorize it (§15.5,
// and the Rovo action docs). The caller is read from context.principal.accountId, verified on the
// demo site to be the real invoking user.
import { getTicketContext as getTicketContextTool, GetTicketContextResult } from '../mcp/tools';

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

export async function getTicketContext(
  payload: Record<string, unknown>,
  context?: Record<string, unknown>,
): Promise<GetTicketContextResult | InvalidRequest> {
  const callerAccountId = (context as { principal?: { accountId?: unknown } } | undefined)?.principal?.accountId;
  // No authenticated caller: refuse. Never fall back to the app's identity (§16.2).
  if (typeof callerAccountId !== 'string' || callerAccountId.length === 0) {
    return { status: 'invalid-request', message: 'This tool needs a signed-in user.' };
  }
  const ticketKey = resolveTicketKey(payload ?? {});
  if (!ticketKey) {
    return { status: 'invalid-request', message: 'Provide a Jira issue key such as ITS-123.' };
  }
  return getTicketContextTool(ticketKey, callerAccountId);
}
