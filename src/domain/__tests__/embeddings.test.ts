// Embedding-based ranking (step 12). Pure. Vectors are real jina-embeddings-v5-text-small output recorded
// from the demo-site fixtures (tests/fixtures/jina-demo-site.json); no live calls (§19.7).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_EMBEDDING_FLOOR,
  candidateEmbeddingTexts,
  INCIDENT_EMBEDDING_FLOOR,
  cosine,
  EMBEDDING_TEXT_CHARS,
  rerankWithEmbeddings,
  similarities,
  sourceKeyOf,
  ticketEmbeddingText,
} from '../embeddings';
import { Article, Incident, Resolution } from '../types';

const fixture: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'jina-demo-site.json'), 'utf8'));
const now = new Date('2026-11-22T00:00:00Z');

const article = (id: string): Article => ({
  source: { kind: 'confluence-page', id, url: `https://x/wiki/${id}`, title: fixture.candidates[`confluence-page:${id}`]?.title ?? id, updatedAt: '2026-11-01T00:00:00Z' },
  excerpt: 'e',
  kind: 'runbook',
  relevance: 0.5,
});
const incident = (key: string, status: Incident['status'] = 'active'): Incident => ({
  source: { kind: 'jira-issue', id: key, url: `https://x/browse/${key}`, title: key, updatedAt: 'u' },
  status,
  summary: 's',
  relevance: 0.5,
  startedAt: '2026-11-20T00:00:00Z',
});
const resolution = (key: string): Resolution => ({
  source: { kind: 'jira-issue', id: key, url: `https://x/browse/${key}`, title: key, updatedAt: 'u' },
  resolvedAt: '2026-11-10T00:00:00Z',
  resolutionText: 'fix',
  matchReason: 'same-symptom',
  relevance: 0.5,
});
/** Similarities of the given candidates to a recorded ticket, from the recorded vectors. */
const recorded = (ticket: string, items: { source: { kind: string; id: string } }[]) =>
  similarities(fixture.tickets[ticket], items.map((i) => ({ key: sourceKeyOf(i), vector: fixture.candidates[sourceKeyOf(i)].vector })));

const AUTH = '4194312';
const DATABASE = '4292609';
const VPN = '4292631';
const POSTMORTEM_404 = '1572890';

describe('the recorded fixture', () => {
  it('is jina-embeddings-v5-text-small at 1024 dimensions, normalized', () => {
    expect(fixture.model).toBe('jina-embeddings-v5-text-small');
    expect(fixture.dimensions).toBe(1024);
    const v = fixture.tickets['ITS-6267'];
    expect(v).toHaveLength(1024);
    expect(cosine(v, v)).toBeCloseTo(1, 4);
  });
});

describe('article floor on the recorded demo-site runbooks', () => {
  it('ITS-6267 (VPN): of the three runbooks the keyword gate keeps, only the VPN runbook stays', () => {
    for (const ticket of ['ITS-6267', 'ITS-6267 summary']) {
      const articles = [article(AUTH), article(DATABASE), article(VPN)];
      const out = rerankWithEmbeddings({ incidents: [], resolutions: [], articles }, recorded(ticket, articles), now);
      expect(out.articles.map((a) => a.source.id)).toEqual([VPN]);
      expect(out.droppedArticles).toBe(2);
    }
  });

  it('ITS-6265 (login): keeps the Auth runbook, the only one the keyword gate keeps', () => {
    const articles = [article(AUTH)];
    const out = rerankWithEmbeddings({ incidents: [], resolutions: [], articles }, recorded('ITS-6265', articles), now);
    expect(out.articles.map((a) => a.source.id)).toEqual([AUTH]);
  });

  it('would not drop the 404 postmortem for the login ticket on its own: the keyword gate is still needed', () => {
    // Measured: the postmortem scores 89% of the Auth runbook, above the floor. Embeddings refine, keywords choose.
    const articles = [article(AUTH), article(POSTMORTEM_404)];
    const out = rerankWithEmbeddings({ incidents: [], resolutions: [], articles }, recorded('ITS-6265', articles), now);
    expect(out.articles.map((a) => a.source.id)).toEqual([AUTH, POSTMORTEM_404]);
  });

  it('keeps an article exactly at the floor', () => {
    const articles = [article('a'), article('b'), article('c')];
    const sims = new Map([['confluence-page:a', 0.8], ['confluence-page:b', ARTICLE_EMBEDDING_FLOOR * 0.8], ['confluence-page:c', 0.47]]);
    const out = rerankWithEmbeddings({ incidents: [], resolutions: [], articles }, sims, now);
    expect(out.articles.map((a) => a.source.id)).toEqual(['a', 'b']);
  });
});

describe('re-ranking incidents and resolutions on the recorded vectors', () => {
  it('ITS-6267 (VPN): drops the unrelated database incident the live site still showed (42-47% of the VPN incident)', () => {
    for (const ticket of ['ITS-6267', 'ITS-6267 summary']) {
      const incidents = [incident('ITO-9648'), incident('ITO-9649')];
      const out = rerankWithEmbeddings({ incidents, resolutions: [], articles: [] }, recorded(ticket, incidents), now);
      expect(out.incidents.map((i) => i.source.id)).toEqual(['ITO-9649']);
      expect(out.droppedIncidents).toBe(1);
    }
  });

  it('ITS-6267 (VPN): only the two VPN incidents stay; the login incidents are below the floor', () => {
    const incidents = [incident('ITO-9647'), incident('ITO-9642'), incident('ITO-9649'), incident('ITO-9646')];
    const out = rerankWithEmbeddings({ incidents, resolutions: [], articles: [] }, recorded('ITS-6267', incidents), now);
    expect(out.incidents.map((i) => i.source.id).sort()).toEqual(['ITO-9646', 'ITO-9649']);
  });

  it('ITS-6265 (login): the two login incidents lead; a VPN incident would only just pass the floor (61%)', () => {
    // On the live site the keyword gate never admits the VPN incidents for this ticket; this documents the thin margin.
    const incidents = [incident('ITO-9649'), incident('ITO-9646'), incident('ITO-9647'), incident('ITO-9642')];
    const out = rerankWithEmbeddings({ incidents, resolutions: [], articles: [] }, recorded('ITS-6265', incidents), now);
    expect(out.incidents.map((i) => i.source.id)).toEqual(['ITO-9647', 'ITO-9642', 'ITO-9649']);
    expect(out.droppedIncidents).toBe(1);
  });

  it('uses the same 60% floor for incidents and keeps one exactly at it', () => {
    expect(INCIDENT_EMBEDDING_FLOOR).toBe(0.6);
    const incidents = [incident('A'), incident('B'), incident('C')];
    const sims = new Map([['jira-issue:A', 0.5], ['jira-issue:B', INCIDENT_EMBEDDING_FLOOR * 0.5], ['jira-issue:C', 0.29]]);
    expect(rerankWithEmbeddings({ incidents, resolutions: [], articles: [] }, sims, now).incidents.map((i) => i.source.id)).toEqual(['A', 'B']);
  });

  it('keeps status in the score: an active incident can outrank a closer resolved one', () => {
    const incidents = [incident('A', 'resolved'), incident('B', 'active')];
    const sims = new Map([['jira-issue:A', 0.8], ['jira-issue:B', 0.6]]);
    expect(rerankWithEmbeddings({ incidents, resolutions: [], articles: [] }, sims, now).incidents.map((i) => i.source.id)).toEqual(['B', 'A']);
  });

  it('re-orders resolutions by similarity and never drops them (a same-requester match need not be similar)', () => {
    const resolutions = [resolution('R1'), resolution('R2')];
    const sims = new Map([['jira-issue:R1', 0.2], ['jira-issue:R2', 0.9]]);
    const out = rerankWithEmbeddings({ incidents: [], resolutions, articles: [] }, sims, now);
    expect(out.resolutions.map((r) => r.source.id)).toEqual(['R2', 'R1']);
  });
});

describe('all or nothing', () => {
  it('returns the sections unchanged when any candidate has no similarity', () => {
    const sections = { incidents: [incident('A'), incident('B')], resolutions: [resolution('R')], articles: [article('x'), article('y')] };
    const out = rerankWithEmbeddings(sections, new Map([['jira-issue:B', 0.9]]), now);
    expect(out).toEqual({ ...sections, droppedArticles: 0, droppedIncidents: 0 });
  });

  it('handles empty sections', () => {
    expect(rerankWithEmbeddings({ incidents: [], resolutions: [], articles: [] }, new Map(), now)).toEqual({ incidents: [], resolutions: [], articles: [], droppedArticles: 0, droppedIncidents: 0 });
  });
});

describe('cosine and similarities', () => {
  it('computes cosine for any lengths of vector, and 0 for mismatched, empty or zero vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([2, 0], [3, 0])).toBe(1);
    expect(cosine([1, 1], [1, 1])).toBeCloseTo(1, 10);
    expect(cosine([1], [1, 0])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(cosine(undefined as never, [1])).toBe(0);
  });

  it('maps negative cosines to 0 (spec 9.1 normalizeCosine)', () => {
    expect(similarities([1, 0], [{ key: 'k', vector: [-1, 0] }]).get('k')).toBe(0);
  });
});

describe('texts sent for embedding (spec 12.3: minimum content, emails and links replaced)', () => {
  it('ticket: summary and description, minimized and cut to EMBEDDING_TEXT_CHARS', () => {
    expect(ticketEmbeddingText({ summary: 'VPN down', description: 'see https://x.example/a or mail ops@corp.com' })).toBe('VPN down see [link] or mail [email]');
    const long = ticketEmbeddingText({ summary: 's', description: 'word '.repeat(400) });
    expect(long.length).toBeLessThanOrEqual(EMBEDDING_TEXT_CHARS + 1);
  });

  it('candidates: title and stored excerpt, keyed by source, incidents then resolutions then articles', () => {
    const out = candidateEmbeddingTexts({ incidents: [incident('ITO-1')], resolutions: [resolution('ITO-2')], articles: [article('9')] });
    expect(out).toEqual([
      { key: 'jira-issue:ITO-1', text: 'ITO-1 s' },
      { key: 'jira-issue:ITO-2', text: 'ITO-2 fix' },
      { key: 'confluence-page:9', text: '9 e' },
    ]);
  });
});
