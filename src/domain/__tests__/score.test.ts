// Ranking tests (spec §9, §19.2). Fixed clocks only: ranking must be deterministic.
import { describe, expect, it } from 'vitest';
import {
  INCIDENT_AUTHORITY,
  INCIDENT_STATUS_WEIGHT,
  incidentComponents,
  limitCandidates,
  MAX_BUNDLE_CANDIDATES,
  normalizeCosine,
  rank,
  Rankable,
  RECENCY_HALF_LIFE_DAYS,
  recencyScore,
  RESOLUTION_AUTHORITY,
  RESOLUTION_STATUS_WEIGHT,
  resolutionComponents,
  score,
  SCORE_EPSILON,
  ScoreComponents,
  WEIGHT_AUTHORITY,
  WEIGHT_RECENCY,
  WEIGHT_RELATIONSHIP,
  WEIGHT_SEMANTIC,
  WEIGHT_STATUS,
} from '../score';

const NOW = new Date('2026-11-21T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
const components = (overrides: Partial<ScoreComponents> = {}): ScoreComponents => ({
  semantic: 0.5,
  relationship: 0,
  status: 0.2,
  recency: 0.5,
  authority: 0.5,
  ...overrides,
});
const item = (key: string, c: Partial<ScoreComponents> = {}, sharedService = false): Rankable<string> => ({
  item: key,
  sourceKey: `jira-issue:${key}`,
  components: components(c),
  sharedService,
});
const order = (items: Rankable<string>[]) => rank(items).map((r) => r.item);

describe('weights', () => {
  it('sum to 1, so a score stays within 0..1', () => {
    expect(WEIGHT_SEMANTIC + WEIGHT_RELATIONSHIP + WEIGHT_STATUS + WEIGHT_RECENCY + WEIGHT_AUTHORITY).toBeCloseTo(1);
    expect(score({ semantic: 1, relationship: 1, status: 1, recency: 1, authority: 1 })).toBeCloseTo(1);
    expect(score({ semantic: 0, relationship: 0, status: 0, recency: 0, authority: 0 })).toBe(0);
  });
});

describe('normalizeCosine (§9.1)', () => {
  it.each([
    [-0.4, 0],
    [0, 0],
    [0.42, 0.42],
    [1, 1],
    [1.0000001, 1],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeCosine(input)).toBe(expected);
  });

  it('is applied inside score, so negative similarity cannot lower a score', () => {
    expect(score(components({ semantic: -1 }))).toBe(score(components({ semantic: 0 })));
  });
});

describe('recencyScore (§9.4)', () => {
  it('is 1 for now, 0.5 after one half-life and 0.25 after two', () => {
    expect(recencyScore(NOW.toISOString(), NOW)).toBe(1);
    expect(recencyScore(daysAgo(RECENCY_HALF_LIFE_DAYS), NOW)).toBeCloseTo(0.5);
    expect(recencyScore(daysAgo(2 * RECENCY_HALF_LIFE_DAYS), NOW)).toBeCloseTo(0.25);
  });

  it('is deterministic for fixed timestamps', () => {
    expect(recencyScore(daysAgo(7), NOW)).toBe(recencyScore(daysAgo(7), NOW));
  });

  it('treats future timestamps as now', () => {
    expect(recencyScore(daysAgo(-3), NOW)).toBe(1);
  });

  it('scores missing or invalid timestamps as 0', () => {
    expect(recencyScore(undefined, NOW)).toBe(0);
    expect(recencyScore('', NOW)).toBe(0);
    expect(recencyScore('not a date', NOW)).toBe(0);
  });
});

describe('component builders', () => {
  it('use the incident status weights and constant incident authority (§9.3, §9.5)', () => {
    for (const s of ['active', 'monitoring', 'resolved'] as const) {
      const c = incidentComponents(s, NOW.toISOString(), 0.3, NOW);
      expect(c.status).toBe(INCIDENT_STATUS_WEIGHT[s]);
      expect(c.authority).toBe(INCIDENT_AUTHORITY);
      expect(c.semantic).toBe(0.3);
      expect(c.relationship).toBe(0);
    }
  });

  it('use the flat resolution status weight and resolution authority', () => {
    const c = resolutionComponents(daysAgo(30), 0.4, NOW);
    expect(c).toEqual({ semantic: 0.4, relationship: 0, status: RESOLUTION_STATUS_WEIGHT, recency: expect.closeTo(0.5, 5), authority: RESOLUTION_AUTHORITY });
  });

  it('accept a relationship strength for when Teamwork Graph lands', () => {
    expect(incidentComponents('active', undefined, 0, NOW, 1).relationship).toBe(1);
    expect(resolutionComponents(undefined, 0, NOW, 1).relationship).toBe(1);
  });
});

describe('rank (§9.6, §19.2)', () => {
  it('ranks an active incident above a resolved one at equal similarity', () => {
    const active = { item: 'active', sourceKey: 'jira-issue:B', components: incidentComponents('active', daysAgo(1), 0.5, NOW) };
    const resolved = { item: 'resolved', sourceKey: 'jira-issue:A', components: incidentComponents('resolved', daysAgo(1), 0.5, NOW) };
    expect(order([resolved, active])).toEqual(['active', 'resolved']);
  });

  it('ranks higher relationship strength above lower at equal similarity', () => {
    expect(order([item('A', { relationship: 0 }), item('B', { relationship: 1 })])).toEqual(['B', 'A']);
  });

  it('ranks higher similarity above lower when everything else is equal', () => {
    expect(order([item('A', { semantic: 0.2 }), item('B', { semantic: 0.8 })])).toEqual(['B', 'A']);
  });

  it('still ranks when embeddings are missing (semantic similarity 0)', () => {
    const ranked = rank([item('A', { semantic: 0, status: 1 }), item('B', { semantic: 0, status: 0.2 })]);
    expect(ranked.map((r) => r.item)).toEqual(['A', 'B']);
    expect(ranked.every((r) => Number.isFinite(r.score))).toBe(true);
  });

  it('breaks score ties by shared service first (agreed tie-breaker)', () => {
    expect(order([item('A'), item('B', {}, true)])).toEqual(['B', 'A']);
  });

  it('breaks remaining ties by recency, then by source key ascending', () => {
    // Equal scores with different recency need offsetting components. Both orders of input must
    // give the same result, so the outcome cannot depend on floating-point noise or input order.
    const older = item('A', { recency: 0.2, authority: 0.6 });
    const newer = item('B', { recency: 0.6, authority: 0.2 });
    expect(score(older.components)).toBeCloseTo(score(newer.components));
    expect(order([older, newer])).toEqual(['B', 'A']);
    expect(order([newer, older])).toEqual(['B', 'A']);
    expect(order([item('C'), item('A'), item('B')])).toEqual(['A', 'B', 'C']);
  });

  it('treats scores within SCORE_EPSILON as tied', () => {
    const a = item('A', { semantic: 0.5 });
    const b = item('B', { semantic: 0.5 + SCORE_EPSILON / 10 }, true);
    // B's score is a hair higher, but the tie-breaker (shared service) must decide, not the noise.
    expect(order([b, a])).toEqual(['B', 'A']);
    expect(order([item('A', { semantic: 0.5 + SCORE_EPSILON / 10 }), item('B', { semantic: 0.5 })])).toEqual(['A', 'B']);
  });

  it('never lets a shared service outrank a higher score', () => {
    expect(order([item('A', { semantic: 0.9 }), item('B', { semantic: 0.1 }, true)])).toEqual(['A', 'B']);
  });

  it('returns the score with each item and does not mutate the input', () => {
    const input = [item('B'), item('A')];
    const copy = JSON.stringify(input);
    const ranked = rank(input);
    expect(ranked[0].score).toBeCloseTo(score(components()));
    expect(JSON.stringify(input)).toBe(copy);
  });

  it('handles an empty list', () => {
    expect(rank([])).toEqual([]);
  });

  it('keeps input order for fully identical entries (stable sort)', () => {
    const first = { ...item('A'), item: 'first' };
    const second = { ...item('A'), item: 'second' };
    expect(order([first, second])).toEqual(['first', 'second']);
    expect(order([second, first])).toEqual(['second', 'first']);
  });
});

describe('limitCandidates (§9.6)', () => {
  const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it('keeps everything when under the limit', () => {
    expect(limitCandidates([range('i', 3), range('r', 2)], 20)).toEqual([range('i', 3), range('r', 2)]);
  });

  it('defaults to the bundle limit of 20', () => {
    const [a, b] = limitCandidates([range('i', 15), range('r', 15)]);
    expect(a.length + b.length).toBe(MAX_BUNDLE_CANDIDATES);
  });

  it('takes turns between sections so neither is crowded out, keeping each section order', () => {
    const [a, b] = limitCandidates([range('i', 10), range('r', 10)], 5);
    expect(a).toEqual(['i0', 'i1', 'i2']);
    expect(b).toEqual(['r0', 'r1']);
  });

  it('gives unused room to sections that have more', () => {
    const [a, b] = limitCandidates([range('i', 1), range('r', 10)], 6);
    expect(a).toEqual(['i0']);
    expect(b).toEqual(range('r', 5));
  });

  it('handles empty sections and a zero limit', () => {
    expect(limitCandidates([[], []], 20)).toEqual([[], []]);
    expect(limitCandidates([range('i', 3)], 0)).toEqual([[]]);
  });
});
