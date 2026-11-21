// Search queries for the find-* MCP tools (spec §15.2, §15.3). Pure: no Forge imports, no I/O.
//
// Retrieval (adapters/jira.ts) ranks candidates against a Ticket. A tool query is turned into one:
// - ticket only: the ticket as it is now.
// - ticket plus free text: the ticket wins; the text is a hint, appended to the description so it adds
//   keywords without outweighing the ticket's own summary (summary words count double, §9).
// - free text only: a ticket-shaped query with no key, requester or services, so only symptom matching
//   applies. The text never reaches JQL; it is only compared with candidates in the app.
import { Ticket } from './types';

// Longest free text accepted; longer input is cut. Enough for a pasted error description.
export const MAX_QUERY_CHARS = 500;
// Results returned per tool call. Matches the panel's per-section limit (MAX_DISPLAY_ITEMS_PER_SECTION), so
// an agent never sees more items than a person looking at the panel.
export const MAX_TOOL_RESULTS = 5;

/** Trimmed, whitespace-collapsed, capped free text; undefined if there is none. */
export function cleanQueryText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS).trim();
  return text.length > 0 ? text : undefined;
}

/** A ticket-shaped query for free text alone: no key, requester, services or labels. */
export function textQuery(text: string): Ticket {
  return { key: '', projectKey: '', summary: text, description: '', labels: [], serviceIds: [], status: '', updatedAt: '' };
}

/** The ticket with the agent's free text appended to its description as an extra hint. */
export function withHint(ticket: Ticket, text: string | undefined): Ticket {
  if (!text) return ticket;
  return { ...ticket, description: ticket.description ? `${ticket.description}\n${text}` : text };
}
