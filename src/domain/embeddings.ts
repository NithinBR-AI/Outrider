// Embedding-based ranking (step 12, spec §9.1, §12). Pure: no Forge imports, no I/O.
//
// Agreed design (2026-11-22, Specs.md Phase 8 decisions):
// - Keywords still choose the candidates (adapters/jira.ts, adapters/confluence.ts). Embeddings then supply
//   the semantic component of the §9 score for those candidates, and every section is re-ranked.
// - Articles also get an embedding floor: kept only at >= ARTICLE_EMBEDDING_FLOOR of the best article's
//   cosine. Measured on the recorded demo-site pages with jina-embeddings-v5-text-small (1024 dimensions):
//   for the VPN ticket the Auth and Database runbooks score 43-55% of the VPN runbook and are dropped; the
//   keyword relative floor alone kept them at 86%. Incidents get the same floor (agreed after the live check of
//   ITS-6267, which still showed the unrelated database incident ITO-9648 through "connection"; recorded share 42-47%).
//   Resolutions are only re-ordered: a same-requester match is kept even when its text is not similar.
// - All or nothing: if any candidate lacks a vector the sections are returned unchanged (keyword ranking).
//   The caller also falls back on any provider failure (§12.5). Exact score ties, now very unlikely, are
//   broken by recency and source key; the shared Affected service tie-breaker applies only in the keyword
//   ranking, which the adapters perform.
import { Article, Incident, Resolution, Ticket } from './types';
import { articleComponents, incidentComponents, normalizeCosine, rank, resolutionComponents, SCORE_EPSILON } from './score';
import { minimizeText } from './generate';

// Characters of text embedded per item: the ticket's summary and description, or a candidate's title and
// stored excerpt. Matches the measurement; keeps a build at about 2,000 tokens.
export const EMBEDDING_TEXT_CHARS = 600;
// Articles and incidents kept at or above this share of the best one's cosine in their section (see the header).
export const ARTICLE_EMBEDDING_FLOOR = 0.6;
export const INCIDENT_EMBEDDING_FLOOR = 0.6;

export type Sections = { incidents: Incident[]; resolutions: Resolution[]; articles: Article[] };

/** The composite source key (§7.1), used to match a candidate with its vector. */
export const sourceKeyOf = (item: { source: { kind: string; id: string } }): string => `${item.source.kind}:${item.source.id}`;

/** The ticket text sent for embedding: emails and links replaced, as in the summary prompt (§12.3). */
export function ticketEmbeddingText(ticket: Pick<Ticket, 'summary' | 'description'>): string {
  return minimizeText(`${ticket.summary}\n${ticket.description}`, EMBEDDING_TEXT_CHARS);
}

/** Every candidate's text for embedding: title and stored excerpt, minimized the same way. */
export function candidateEmbeddingTexts(sections: Sections): { key: string; text: string }[] {
  const text = (title: string, body: string) => minimizeText(`${title}\n${body}`, EMBEDDING_TEXT_CHARS);
  return [
    ...sections.incidents.map((i) => ({ key: sourceKeyOf(i), text: text(i.source.title, i.summary) })),
    ...sections.resolutions.map((r) => ({ key: sourceKeyOf(r), text: text(r.source.title, r.resolutionText) })),
    ...sections.articles.map((a) => ({ key: sourceKeyOf(a), text: text(a.source.title, a.excerpt) })),
  ];
}

/** Cosine similarity. 0 for vectors of different or zero length, so a malformed vector never ranks high. */
export function cosine(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Each candidate's similarity to the ticket, through §9.1's normalizeCosine. */
export function similarities(ticketVector: number[], candidates: { key: string; vector: number[] }[]): Map<string, number> {
  return new Map(candidates.map((c) => [c.key, normalizeCosine(cosine(ticketVector, c.vector))]));
}

/**
 * The sections re-ranked with embedding similarity as the semantic component (§9), and articles and incidents
 * below their floor dropped. Returns the input unchanged (nothing dropped) unless every candidate has a similarity.
 */
export function rerankWithEmbeddings(sections: Sections, sims: Map<string, number>, now: Date): Sections & { droppedArticles: number; droppedIncidents: number } {
  const all = [...sections.incidents, ...sections.resolutions, ...sections.articles];
  if (all.some((item) => !sims.has(sourceKeyOf(item)))) return { ...sections, droppedArticles: 0, droppedIncidents: 0 };
  const sim = (item: { source: { kind: string; id: string } }) => sims.get(sourceKeyOf(item)) as number;
  // SCORE_EPSILON: a share exactly at the floor passes despite floating-point noise.
  const aboveFloor = <T extends { source: { kind: string; id: string } }>(items: T[], floor: number): T[] => {
    let best = 0;
    for (const item of items) best = Math.max(best, sim(item));
    return items.filter((item) => sim(item) + SCORE_EPSILON >= floor * best);
  };

  const keptIncidents = aboveFloor(sections.incidents, INCIDENT_EMBEDDING_FLOOR);
  const incidents = rank(keptIncidents.map((i) => ({ item: i, sourceKey: sourceKeyOf(i), components: incidentComponents(i.status, i.startedAt, sim(i), now) }))).map((r) => r.item);
  const resolutions = rank(sections.resolutions.map((r) => ({ item: r, sourceKey: sourceKeyOf(r), components: resolutionComponents(r.resolvedAt, sim(r), now) }))).map((r) => r.item);

  const kept = aboveFloor(sections.articles, ARTICLE_EMBEDDING_FLOOR);
  const articles = rank(kept.map((a) => ({ item: a, sourceKey: sourceKeyOf(a), components: articleComponents(a.kind, a.source.updatedAt, sim(a), now) }))).map((r) => r.item);

  return { incidents, resolutions, articles, droppedArticles: sections.articles.length - kept.length, droppedIncidents: sections.incidents.length - keptIncidents.length };
}
