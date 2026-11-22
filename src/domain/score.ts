// Deterministic ranking (spec §9). Pure: no Forge imports, no I/O, no clock reads ("now" is passed in).
//
// Documented deviations, agreed for step 6b:
//   - semanticSimilarity: the adapters rank by keyword overlap (domain/extract.ts) through normalizeCosine.
//     With embeddings (step 12, domain/embeddings.ts) the builder re-ranks with the real cosine; the keyword
//     overlap remains the fallback when embeddings are unavailable.
//   - relationshipStrength: stays 0 until Teamwork Graph confirms relationships (step 11). A shared
//     Jira "Affected services" value is only a tie-breaker in the ordering, never part of the score.

// ---- Weights (§9). All components are normalized to 0..1, so the score is 0..1. ----
export const WEIGHT_SEMANTIC = 0.35;
export const WEIGHT_RELATIONSHIP = 0.25;
export const WEIGHT_STATUS = 0.2;
export const WEIGHT_RECENCY = 0.1;
export const WEIGHT_AUTHORITY = 0.1;

// ---- Recency (§9.4): exponential decay. ----
export const RECENCY_HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---- Status weight (§9.3). The only score term derived from status. ----
export const INCIDENT_STATUS_WEIGHT = { active: 1.0, monitoring: 0.6, resolved: 0.2 } as const;
export const RESOLUTION_STATUS_WEIGHT = 0.2;

// ---- Source authority (§9.5). Constant per source type, never derived from status. ----
export const INCIDENT_AUTHORITY = 0.7;
export const RESOLUTION_AUTHORITY = 0.5;

// ---- Candidate limits (§3.2, §9.6). Stored and displayed limits are separate. ----
export const MAX_BUNDLE_CANDIDATES = 20;
export const MAX_DISPLAY_ITEMS_PER_SECTION = 5;

export type ScoreComponents = {
  semantic: number;
  relationship: number;
  status: number;
  recency: number;
  authority: number;
};

/** The one documented cosine mapping (§9.1): negatives to 0, guards values above 1, NaN to 0. */
export function normalizeCosine(cosine: number): number {
  if (!Number.isFinite(cosine)) return 0;
  return Math.max(0, Math.min(1, cosine));
}

/** Exponential decay with RECENCY_HALF_LIFE_DAYS. Missing or invalid timestamps score 0; future ones score 1. */
export function recencyScore(iso: string | undefined, now: Date): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  const ageDays = Math.max(0, (now.getTime() - t) / MS_PER_DAY);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

/** Weighted sum of the five components (§9). */
export function score(c: ScoreComponents): number {
  return (
    WEIGHT_SEMANTIC * normalizeCosine(c.semantic) +
    WEIGHT_RELATIONSHIP * c.relationship +
    WEIGHT_STATUS * c.status +
    WEIGHT_RECENCY * c.recency +
    WEIGHT_AUTHORITY * c.authority
  );
}

export function incidentComponents(
  status: keyof typeof INCIDENT_STATUS_WEIGHT,
  startedAt: string | undefined,
  semantic: number,
  now: Date,
  relationship = 0,
): ScoreComponents {
  return { semantic, relationship, status: INCIDENT_STATUS_WEIGHT[status], recency: recencyScore(startedAt, now), authority: INCIDENT_AUTHORITY };
}

export function resolutionComponents(resolvedAt: string | undefined, semantic: number, now: Date, relationship = 0): ScoreComponents {
  return { semantic, relationship, status: RESOLUTION_STATUS_WEIGHT, recency: recencyScore(resolvedAt, now), authority: RESOLUTION_AUTHORITY };
}

// Articles (§9.3, §9.4, §9.5): constant status weight, recency from source.updatedAt, authority by kind.
export const ARTICLE_STATUS_WEIGHT = 0.2;
export const ARTICLE_AUTHORITY = { runbook: 1.0, policy: 1.0, guide: 0.7 } as const;

export function articleComponents(kind: keyof typeof ARTICLE_AUTHORITY, updatedAt: string | undefined, semantic: number, now: Date, relationship = 0): ScoreComponents {
  return { semantic, relationship, status: ARTICLE_STATUS_WEIGHT, recency: recencyScore(updatedAt, now), authority: ARTICLE_AUTHORITY[kind] };
}

// Scores closer than this count as equal. Weighted sums of decimals carry floating-point noise
// (0.1 * 0.2 + 0.1 * 0.6 differs from 0.1 * 0.6 + 0.1 * 0.2 in the last bits); without a tolerance that
// noise, not the documented tie-breakers, would decide the order of equally scored items.
export const SCORE_EPSILON = 1e-9;

export type Rankable<T> = {
  item: T;
  /** Composite source key "kind:id" (§7.1), the final tie-breaker. */
  sourceKey: string;
  components: ScoreComponents;
  /** Shares an Affected service with the ticket. Tie-breaker only. */
  sharedService?: boolean;
};

/**
 * Deterministic ordering (§9.6): score descending, then shared service (agreed tie-breaker),
 * then recency descending, then composite source key ascending. Does not mutate the input.
 */
export function rank<T>(items: Rankable<T>[]): { item: T; score: number }[] {
  return items
    .map((r) => ({ r, s: score(r.components) }))
    .sort(
      (a, b) =>
        (Math.abs(b.s - a.s) > SCORE_EPSILON ? b.s - a.s : 0) ||
        Number(!!b.r.sharedService) - Number(!!a.r.sharedService) ||
        b.r.components.recency - a.r.components.recency ||
        (a.r.sourceKey < b.r.sourceKey ? -1 : a.r.sourceKey > b.r.sourceKey ? 1 : 0),
    )
    .map(({ r, s }) => ({ item: r.item, score: s }));
}

/**
 * Applies the stored-candidate limit across sections (§9.6). Each section keeps its own order;
 * sections take turns by rank position so no section is crowded out by another.
 */
export function limitCandidates<T extends unknown[][]>(sections: [...T], max = MAX_BUNDLE_CANDIDATES): [...T] {
  const kept = sections.map(() => 0);
  let total = 0;
  for (let position = 0; total < max; position++) {
    let progressed = false;
    for (let s = 0; s < sections.length && total < max; s++) {
      if (position < sections[s].length) {
        kept[s]++;
        total++;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return sections.map((items, s) => items.slice(0, kept[s])) as [...T];
}
