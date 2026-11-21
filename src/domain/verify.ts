// Source-span verifier (spec §13). Pure: no Forge imports, no I/O.
//
// A generated claim is shown only if (1) it cites a source, (2) that source resolves and the current
// viewer may see it, and (3) the claim shares a verbatim span with the source's CURRENT text. This proves
// text overlap only, not that the claim is true or that the source entails it (§13.1).
//
// Agreed choices for step 7:
// - Matching is on whole words, so spans never start or end mid-word.
// - A span must be at least MIN_SPAN_CHARS long (normalized) AND contain at least
//   MIN_DISTINCTIVE_WORDS distinctive words, so common phrases ("the user cannot") are not evidence.
// - Normalization (applied identically to claim and source): typographic quotes and dashes to ASCII,
//   Markdown markers removed, case-folded, whitespace collapsed. Quote and dash folding is a small,
//   documented addition to §13.2 step 4.
// Added in step 8c (§13.2 step 6a): qualifying spans must also cover at least MIN_COVERAGE of the claim's
// distinctive words. Known cost: matching is on words, not meaning, so a correctly reworded claim can fail.
import { tokenize } from './extract';
import { Claim, GeneratedClaim, RejectedClaim, SourceRef, SummaryResponse } from './types';

export const MIN_SPAN_CHARS = 12;
export const MIN_DISTINCTIVE_WORDS = 2;
// Share of a claim's distinctive words that qualifying spans must cover (§13.2 step 6a). Without it, a long
// claim passed on one short shared phrase ("certificate expiry", 2 of 31 words in the step 8c prompt test).
export const MIN_COVERAGE = 0.5;

/** Folds typographic punctuation so "That’s" in a source matches "That's" in a claim. */
function foldPunctuation(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u00A0/g, ' ');
}

/**
 * Normalizes one word: folds typographic punctuation, strips non-alphanumeric characters at both ends,
 * case-folds. Stripping the ends removes Markdown markers (`**bold**`, `_em_`, `` `code` ``, `## `, `> `,
 * list bullets) as well as quotes, brackets and sentence punctuation, while keeping punctuation inside a
 * word ("auth-lb-01", "02:00", "let's").
 */
export function normalizeWord(word: string): string {
  return foldPunctuation(word)
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLowerCase();
}

type Word = { norm: string; start: number; end: number };

/** Splits text into normalized words, keeping each word's position in the original text. */
export function toWords(text: string): Word[] {
  const words: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? '')) !== null) {
    const norm = normalizeWord(m[0]);
    if (norm) words.push({ norm, start: m.index, end: m.index + m[0].length });
  }
  return words;
}

/** Normalized form of a whole text: what both sides are compared on (§13.2 step 4). */
export function normalizeText(text: string): string {
  return toWords(text)
    .map((w) => w.norm)
    .join(' ');
}

export type SpanMatch = { span: string; normalizedSpan: string };

/** True if a normalized span is long and distinctive enough to count as evidence. */
export function qualifies(normalizedSpan: string): boolean {
  if (normalizedSpan.length < MIN_SPAN_CHARS) return false;
  return new Set(tokenize(normalizedSpan)).size >= MIN_DISTINCTIVE_WORDS;
}

/**
 * Finds the longest qualifying run of consecutive words shared by the claim and the source (§13.2 step 5).
 * Returns the span as it appears in the ORIGINAL source text (case and punctuation preserved), or null.
 * Every maximal common run is considered, so a long boilerplate run cannot hide a shorter real one.
 * Ties go to the earliest run in the source, so results are deterministic.
 */
/** One maximal qualifying run of words shared by claim and source, as word index ranges [start, end). */
type Run = { startA: number; endA: number; startB: number; endB: number; normalized: string };

/**
 * Every maximal run of consecutive words that the claim and the source share and that qualifies
 * (MIN_SPAN_CHARS and MIN_DISTINCTIVE_WORDS). Shared by findSpan and spanCoverage, so the span the panel
 * shows and the coverage rule always agree on what counts as a match.
 */
function qualifyingRuns(a: Word[], b: Word[]): Run[] {
  const runs: Run[] = [];
  // cur[j] = length of the common run ending at a[i-1], b[j-1] (rolling over i).
  let prev = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint32Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1].norm === b[j - 1].norm) cur[j] = prev[j - 1] + 1;
    }
    // A run is maximal when it cannot be extended by the next word pair.
    for (let j = 1; j <= b.length; j++) {
      const len = cur[j];
      if (len === 0) continue;
      const extends_ = i < a.length && j < b.length && a[i].norm === b[j].norm;
      if (extends_) continue;
      const normalized = b.slice(j - len, j).map((w) => w.norm).join(' ');
      if (qualifies(normalized)) runs.push({ startA: i - len, endA: i, startB: j - len, endB: j, normalized });
    }
    prev = cur;
  }
  return runs;
}

/**
 * Finds the longest qualifying run of consecutive words shared by the claim and the source (§13.2 step 5).
 * Returns the span as it appears in the ORIGINAL source text (case and punctuation preserved), or null.
 * Every maximal common run is considered, so a long boilerplate run cannot hide a shorter real one.
 * Ties go to the earliest run in the source, so results are deterministic.
 */
export function findSpan(claimText: string, sourceText: string): SpanMatch | null {
  const b = toWords(sourceText);
  let best: Run | null = null;
  for (const run of qualifyingRuns(toWords(claimText), b)) {
    const better = !best || run.normalized.length > best.normalized.length || (run.normalized.length === best.normalized.length && run.startB < best.startB);
    if (better) best = run;
  }
  if (!best) return null;
  return { span: sourceText.slice(b[best.startB].start, b[best.endB - 1].end), normalizedSpan: best.normalized };
}

/**
 * Share (0..1) of the claim's distinctive words that lie inside qualifying runs shared with the source
 * (§13.2 step 6a). Several separate runs may each contribute. Distinctive words are those tokenize keeps
 * (no stopwords or short words), counted once each, so filler words neither help nor hurt.
 */
export function spanCoverage(claimText: string, sourceText: string): number {
  const a = toWords(claimText);
  const distinctive = new Set(tokenize(a.map((w) => w.norm).join(' ')));
  if (distinctive.size === 0) return 0;
  const covered = new Array<boolean>(a.length).fill(false);
  for (const run of qualifyingRuns(a, toWords(sourceText))) for (let k = run.startA; k < run.endA; k++) covered[k] = true;
  const coveredWords = new Set(tokenize(a.filter((_, k) => covered[k]).map((w) => w.norm).join(' ')));
  return [...distinctive].filter((w) => coveredWords.has(w)).length / distinctive.size;
}

/** The current text of one cited source, already authorized for the viewer and freshly retrieved. */
export type LiveSource = { ref: SourceRef; text: string };

export const sourceKey = (ref: Pick<SourceRef, 'kind' | 'id'>) => `${ref.kind}:${ref.id}`;

/**
 * Read-time verification for one viewer (§13.2, §13.6). `live` holds only sources that resolve AND that
 * the viewer may see, with their text as retrieved now. Anything not in `live` is indistinguishable from
 * a source that does not exist.
 *
 * Order matters and is authoritative (§13.2):
 * 1. No citation, or the cited source is not in `live` (unresolvable or unauthorized): the claim is
 *    omitted entirely. It is neither shown nor rejected, so its existence is never disclosed.
 * 2. Otherwise the claim is matched against the live text. It is kept (with its longest span and the live
 *    source reference) only if a qualifying span exists AND qualifying spans cover at least MIN_COVERAGE
 *    of its distinctive words. Otherwise it is rejected with reason no-matching-span, the only reason a
 *    viewer ever sees.
 */
export function verifyClaims(claims: GeneratedClaim[], live: Map<string, LiveSource>): SummaryResponse {
  const kept: Claim[] = [];
  const rejected: RejectedClaim[] = [];
  for (const claim of claims ?? []) {
    if (!claim.citedSourceRef) continue;
    const source = live.get(sourceKey(claim.citedSourceRef));
    if (!source) continue;
    const match = findSpan(claim.text, source.text);
    if (match && spanCoverage(claim.text, source.text) >= MIN_COVERAGE) kept.push({ text: claim.text, source: source.ref, span: match.span, grounded: true });
    else rejected.push({ text: claim.text, reason: 'no-matching-span' });
  }
  return { claims: kept, rejected };
}

/** The cited sources a summary needs fetched for verification, one entry per distinct source. */
export function citedSources(claims: GeneratedClaim[]): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const c of claims ?? []) if (c.citedSourceRef && !seen.has(sourceKey(c.citedSourceRef))) seen.set(sourceKey(c.citedSourceRef), c.citedSourceRef);
  return [...seen.values()];
}
