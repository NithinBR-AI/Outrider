// Pure text and status helpers used by retrieval. No Forge imports and no I/O (spec §19.1).
import { Incident } from './types';

// Words that carry no symptom meaning in support tickets. Matching on these produces noise.
const STOPWORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been',
  'before', 'being', 'but', 'by', 'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'for', 'from', 'get',
  'getting', 'had', 'has', 'have', 'having', 'hello', 'help', 'hi', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
  'its', 'just', 'me', 'my', 'no', 'not', 'now', 'of', 'on', 'or', 'other', 'our', 'out', 'over', 'please',
  'same', 'so', 'some', 'still', 'than', 'thank', 'thanks', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'to', 'today', 'too', 'tried', 'try', 'trying', 'up', 'us', 'very', 'was',
  'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
  'issue', 'issues', 'problem', 'unable', 'started', 'minutes', 'ago', 'anything', 'something', 'colleague',
  'colleagues', 'team', 'entire', 'whole', 'work', 'working', 'since', 'months', 'morning', 'result',
  // Generic support vocabulary. These appear in almost every ticket ("error message", "system",
  // "affected"), so matching on them links unrelated tickets. Specific codes such as "503" still count.
  'error', 'errors', 'message', 'messages', 'system', 'systems', 'affected', 'affecting', 'use', 'used', 'using',
  'show', 'shows', 'showing', 'different', 'enter', 'seem', 'seems', 'happen', 'happening', 'customer',
  'facing', 'blocking', 'blocked', 'user', 'users', 'able',
  // Durations and filler. "60 seconds" or "30 minutes" describe timing, not the symptom.
  'time', 'times', 'second', 'seconds', 'minute', 'hour', 'hours', 'day', 'days', 'week', 'weeks',
  'without', 'haven', 'sometime', 'sometimes', 'completely', 'take', 'takes', 'taking',
]);

// Weight of a keyword taken from the ticket summary, relative to a description keyword.
// The summary is the requester's own one-line statement of the symptom.
export const SUMMARY_KEYWORD_WEIGHT = 2;

// Words that indicate a comment describes a fix or a cause, used to pick the resolution comment.
const FIX_TERMS = new Set([
  'fix', 'fixed', 'resolution', 'root', 'cause', 'caused', 'workaround', 'solution', 'reset', 'restart',
  'restarted', 'reboot', 'rebooted', 'boot', 'renewed', 'renew', 'reverted', 'revert', 'rollback', 'rolled',
  'change', 'changed', 'config', 'configuration', 'patched', 'patch', 'upgrade', 'upgraded', 'replaced',
  'cleared', 'reloaded', 'redeployed', 'created', 'index', 'found',
]);

// Comments shorter than this are acknowledgements ("Thank you!"), never a fix description.
const MIN_RESOLUTION_COMMENT_CHARS = 40;

// Minimum token length. Shorter tokens ("is", "to") are almost always noise.
const MIN_TOKEN_LENGTH = 3;

// Maximum number of keywords taken from a ticket. Keeps the overlap ratio meaningful for long descriptions.
export const MAX_TICKET_KEYWORDS = 25;

/** Converts Atlassian Document Format (or a plain string) to plain text. */
export function adfToText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  const parts: string[] = [];
  if (typeof n.text === 'string') parts.push(n.text);
  if (Array.isArray(n.content)) {
    for (const child of n.content) parts.push(adfToText(child));
  }
  // Block-level nodes end with a space so words from adjacent paragraphs do not merge.
  return parts.join(n.type === 'text' ? '' : ' ').replace(/\s+/g, ' ').trim();
}

/** Lower-cases, splits on non-word characters, removes stopwords and applies light plural stemming. */
export function tokenize(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(isMeaningfulToken)
    .map(stem);
}

// Keeps words of at least MIN_TOKEN_LENGTH that are not stopwords. Numbers are dropped,
// except three-digit codes such as HTTP statuses ("503"), which are strong symptom signals.
function isMeaningfulToken(t: string): boolean {
  if (/^\d+$/.test(t)) return t.length === 3;
  return t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t);
}

// Very light stemming so "errors" matches "error" and "failures" matches "failure".
function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** A ticket's distinctive keywords with their weights (summary words count more). */
export type TicketKeywords = Map<string, number>;

/**
 * Picks the distinctive keywords of a ticket. Summary words come first and get
 * SUMMARY_KEYWORD_WEIGHT; description words get weight 1. At most `max` keywords.
 */
export function extractKeywords(summary: string, description: string, max = MAX_TICKET_KEYWORDS): TicketKeywords {
  const weights: TicketKeywords = new Map();
  for (const t of tokenize(summary)) if (weights.size < max) weights.set(t, SUMMARY_KEYWORD_WEIGHT);
  for (const t of tokenize(description)) if (weights.size < max && !weights.has(t)) weights.set(t, 1);
  return weights;
}

/** Weighted fraction of the ticket's keywords that appear in the candidate text, from 0 to 1. */
export function keywordOverlap(keywords: TicketKeywords, candidateText: string): number {
  let total = 0;
  for (const w of keywords.values()) total += w;
  if (total === 0) return 0;
  const candidate = new Set(tokenize(candidateText));
  let hits = 0;
  for (const [k, w] of keywords) if (candidate.has(k)) hits += w;
  return hits / total;
}

/** A comment on a resolved ticket, reduced to what resolution picking needs. */
export type ResolutionCommentCandidate = {
  text: string;
  isPublic: boolean;
  isHumanAgent: boolean; // false for automation ("app" accounts)
  byRequester: boolean; // the ticket's own requester replying ("That worked, thanks")
};

/**
 * Picks the comment that most likely describes the fix. The resolution field is only a category,
 * and the newest comment is often a sign-off ("Thanks for confirming!"), so position is not enough.
 * Eligible: public, written by a human agent, not by the requester, at least MIN_RESOLUTION_COMMENT_CHARS.
 * Best: the most distinct fix terms; ties go to the longer comment, then the earlier position.
 * Returns '' when no comment is eligible.
 */
export function pickResolutionComment(comments: ResolutionCommentCandidate[]): string {
  let best: { text: string; fixTerms: number } | null = null;
  for (const c of comments) {
    const text = c.text.replace(/\s+/g, ' ').trim();
    if (!c.isPublic || !c.isHumanAgent || c.byRequester || text.length < MIN_RESOLUTION_COMMENT_CHARS) continue;
    const fixTerms = new Set(tokenize(text).filter((t) => FIX_TERMS.has(t))).size;
    if (!best || fixTerms > best.fixTerms || (fixTerms === best.fixTerms && text.length > best.text.length)) {
      best = { text, fixTerms };
    }
  }
  return best && best.fixTerms > 0 ? best.text : '';
}

/**
 * Maps a Jira incident workflow status to the Outrider incident status (spec §7.2).
 * Returns null for statuses that should not be shown at all (cancelled incidents).
 * Mapping verified against the demo site's "[System] Incident" workflow.
 */
export function mapIncidentStatus(statusName: string, statusCategoryKey: string): Incident['status'] | null {
  const name = (statusName ?? '').trim().toLowerCase();
  if (name === 'cancelled' || name === 'canceled') return null;
  if (name === 'pending') return 'monitoring';
  if (statusCategoryKey === 'done') return 'resolved';
  return 'active';
}

/** Shortens text for storage and display without cutting words in half. */
export function excerpt(text: string, maxChars: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut) + '…';
}
