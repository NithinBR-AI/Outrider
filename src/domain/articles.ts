// Knowledge articles from Confluence (step 10, spec Phase 6 as agreed: live search, no index). Pure: no
// Forge imports, no I/O. The adapter (adapters/confluence.ts) fetches pages; this module decides what
// is searched for, what text a page contributes, and what kind of article it is.
import { Article } from './types';
import { SPACE_KEY } from './settings';
import { TicketKeywords, tokenize } from './extract';
import { SCORE_EPSILON } from './score';

// Keywords put into one CQL search, the ticket's strongest first (summary words weigh more, §9).
export const MAX_CQL_TERMS = 8;
// Candidate pages fetched per build, from either the CQL search or the page-listing fallback.
export const MAX_ARTICLE_CANDIDATES = 25;
// Stored excerpt length. Only excerpts are persisted, never full page text (spec §7.3).
export const ARTICLE_EXCERPT_CHARS = 600;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/**
 * Plain text from a page body in Confluence storage format (XHTML with ac:/ri: macro elements). Block
 * elements become line breaks so words from adjacent paragraphs never merge; all tags are dropped, CDATA
 * text (code blocks) is kept, and entities are decoded. Matching and the verifier both use this text.
 */
export function storageToText(storage: string): string {
  return (storage ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, text: string) => ` ${text} `)
    .replace(/<(br|hr)\b[^>]*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol|tr|td|th|table|tbody|thead|blockquote|pre|ac:task|ac:layout-cell|ac:structured-macro)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

// An article is kept only if its rarity-weighted score (scoreArticleCandidates) reaches MIN_ARTICLE_SCORE AND is
// at least ARTICLE_RELATIVE_FLOOR of the best article's score. Measured on the demo site: with plain keyword
// overlap, a login ticket matched four unrelated runbooks through "log" and "page"; with these two rules only
// the Auth runbook is kept, including on a summary-only ticket (unrelated runbooks at 55% of the best; a 0.4 floor kept them).
// Residual ties (the VPN ticket's "connect"/"connection" matches at 86%) are left to embeddings (Phase 8).
export const MIN_ARTICLE_SCORE = 0.2;
export const ARTICLE_RELATIVE_FLOOR = 0.6;
// Articles kept per build, before the bundle-wide and display limits (§9.6).
export const MAX_ARTICLE_RESULTS = 10;

/**
 * The article kind (§9.5 authority): from the page's labels; if it has none (the page-listing fallback does
 * not return labels), from a "runbook" or "policy" word in the title; else "guide".
 */
export function articleKind(labels: string[], title = ''): Article['kind'] {
  const names = new Set((labels ?? []).map((l) => l.toLowerCase()));
  if (names.has('runbook')) return 'runbook';
  if (names.has('policy')) return 'policy';
  if (names.size === 0 && /\brunbook\b/i.test(title)) return 'runbook';
  if (names.size === 0 && /\bpolicy\b/i.test(title)) return 'policy';
  return 'guide';
}

/**
 * Rarity-weighted keyword overlap for each candidate page (0..1). Each ticket keyword weighs its summary weight
 * times ln((N + 1) / (df + 0.5)), where N is the number of candidate pages and df the number containing the word:
 * a word found in most candidates ("log", "page", "connection") counts for little, a word found in one ("vpn",
 * "cache") counts for a lot. The weight is always positive, so a single candidate still scores. Computed over this
 * build's candidates only: deterministic and no stored index.
 *
 * A keyword that no candidate contains is left out. It cannot tell candidates apart, yet it had the highest
 * weight and diluted every score: on a second site (2026-11-24), OD-2's long description left 10 of its 20
 * keywords in no page, and the matching Auth runbook scored 0.18 among three runbooks, below MIN_ARTICLE_SCORE.
 */
export function scoreArticleCandidates(keywords: TicketKeywords, texts: Map<string, string>): Map<string, number> {
  const words = new Map([...texts].map(([id, text]) => [id, new Set(tokenize(text))]));
  const n = words.size;
  const weights = new Map<string, number>();
  for (const [k, w] of keywords) {
    let df = 0;
    for (const set of words.values()) if (set.has(k)) df++;
    if (df > 0) weights.set(k, w * Math.log((n + 1) / (df + 0.5)));
  }
  let total = 0;
  for (const w of weights.values()) total += w;
  const scores = new Map<string, number>();
  for (const [id, set] of words) {
    let hit = 0;
    for (const [k, w] of weights) if (set.has(k)) hit += w;
    scores.set(id, total > 0 ? hit / total : 0);
  }
  return scores;
}

/** The candidates to keep: score at least MIN_ARTICLE_SCORE and at least ARTICLE_RELATIVE_FLOOR of the best. */
export function relatedArticleIds(scores: Map<string, number>): Set<string> {
  let best = 0;
  for (const s of scores.values()) best = Math.max(best, s);
  const keep = new Set<string>();
  // SCORE_EPSILON: a score exactly at a threshold passes despite floating-point noise (0.4 * 0.8 = 0.32000000000000006).
  for (const [id, s] of scores) if (s + SCORE_EPSILON >= MIN_ARTICLE_SCORE && s + SCORE_EPSILON >= ARTICLE_RELATIVE_FLOOR * best) keep.add(id);
  return keep;
}

// CQL text terms: only letters and digits, so a keyword can never break out of its quotes.
const CQL_TERM = /^[a-z0-9]+$/;

/**
 * The build-time CQL search: pages in the configured spaces matching any of the ticket's strongest keywords.
 * A phrase search is too strict (verified: "cannot log in error on login page" finds nothing) and every
 * single keyword is too broad, so the strongest few are ORed and the results are scored in the app.
 * Returns undefined when there is nothing to search for (no valid spaces or no usable keywords).
 */
export function articleCql(spaceKeys: string[], keywords: TicketKeywords, maxTerms = MAX_CQL_TERMS): string | undefined {
  const spaces = [...new Set((spaceKeys ?? []).filter((k) => SPACE_KEY.test(k)))];
  const terms = [...keywords.entries()]
    .filter(([t]) => CQL_TERM.test(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([t]) => t);
  if (spaces.length === 0 || terms.length === 0) return undefined;
  return `space in (${spaces.map((s) => `"${s}"`).join(', ')}) AND type = page AND (${terms.map((t) => `text ~ "${t}"`).join(' OR ')})`;
}
