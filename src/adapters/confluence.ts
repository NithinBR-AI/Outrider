// Confluence adapter (step 10, spec Phase 6 as agreed: live search, no index).
//
// Verified on the demo site before writing this:
// - Build time runs AS THE APP. The app only sees spaces it is a member of (Space settings > Members), and
//   CQL search can lag about 10-15 minutes behind a membership change. So the search is hybrid: CQL first;
//   if CQL returns nothing or fails, list the most recently modified pages in the configured spaces instead.
//   Either way the candidates are scored in the app (domain/articles.ts), as Jira candidates are.
// - CQL as a user is not usable: an agent with knowledge-base access only gets HTTP 403 for every search.
// - Read time runs AS THE VIEWER with one batch page fetch by ID (GET /wiki/api/v2/pages?id=...). Pages the
//   viewer cannot see are left out silently (verified: user B gets HTTP 200 with no pages), and the same
//   response carries each page's current body for the verifier.
import api, { route } from '@forge/api';
import { Article, SourceRef, Ticket } from '../domain/types';
import { RetrievalSettings } from '../domain/settings';
import { extractKeywords, excerpt } from '../domain/extract';
import { ARTICLE_EXCERPT_CHARS, articleCql, articleKind, MAX_ARTICLE_CANDIDATES, MAX_ARTICLE_RESULTS, relatedArticleIds, scoreArticleCandidates, storageToText } from '../domain/articles';
import { articleComponents, rank } from '../domain/score';
import { LiveSource } from '../domain/verify';
import { siteBaseUrl } from './jira';

// Confluence page ID shape. Anything else is never sent to Confluence and counts as not visible.
const PAGE_ID = /^\d+$/;
// IDs per batch fetch. A bundle holds at most a few articles, so one call is typical.
const PAGE_BATCH = 50;

type Identity = 'app' | 'user';
const requester = (as: Identity) => (as === 'app' ? api.asApp() : api.asUser());

async function confluenceGet<T>(as: Identity, path: ReturnType<typeof route>, code: string): Promise<T> {
  const res = await requester(as).requestConfluence(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${code}-${res.status}`);
  return (await res.json()) as T;
}

/**
 * The site's wiki base for page links. Confluence returns it in _links.base (verified: the site URL, not the
 * API gateway). If it ever comes back as the gateway, the site URL is looked up as for Jira links.
 */
async function wikiBase(base: string | undefined): Promise<string> {
  if (!base) return '';
  const url = new URL(base);
  if (url.hostname !== 'api.atlassian.com') return base.replace(/\/$/, '');
  return `${await siteBaseUrl(base)}/wiki`;
}

// ---- Shapes (only the fields we read) ----

type Candidate = { id: string; title: string; labels: string[]; updatedAt: string; webui?: string; body?: string };

type SearchResponse = {
  results?: {
    content?: { id?: string; type?: string; title?: string; metadata?: { labels?: { results?: { name?: string }[] } }; _links?: { webui?: string } };
    lastModified?: string;
  }[];
  _links?: { base?: string };
};

type PageListResponse = {
  results?: { id?: string; title?: string; body?: { storage?: { value?: string } }; version?: { createdAt?: string }; _links?: { webui?: string } }[];
  _links?: { base?: string };
};

// ---- Build time, as the app ----

/** CQL search as the app: candidate pages with labels, no bodies. */
async function searchCandidates(cql: string): Promise<{ candidates: Candidate[]; base?: string }> {
  const data = await confluenceGet<SearchResponse>('app', route`/wiki/rest/api/search?cql=${cql}&limit=${MAX_ARTICLE_CANDIDATES}&expand=content.metadata.labels`, 'confluence-search');
  const candidates: Candidate[] = [];
  for (const r of data.results ?? []) {
    const c = r.content;
    if (!c?.id || c.type !== 'page' || !PAGE_ID.test(c.id)) continue;
    const labels = (c.metadata?.labels?.results ?? []).map((l) => l.name ?? '').filter((n) => n.length > 0);
    candidates.push({ id: c.id, title: c.title ?? c.id, labels, updatedAt: r.lastModified ?? '', webui: c._links?.webui });
  }
  return { candidates, base: data._links?.base };
}

/** Pages by ID with their current body, as the given identity. Missing or hidden pages are absent. */
async function pagesById(as: Identity, ids: string[]): Promise<{ pages: PageListResponse['results']; base?: string }> {
  const valid = [...new Set(ids)].filter((id) => PAGE_ID.test(id));
  const pages: NonNullable<PageListResponse['results']> = [];
  let base: string | undefined;
  for (let i = 0; i < valid.length; i += PAGE_BATCH) {
    const batch = valid.slice(i, i + PAGE_BATCH).join(',');
    const data = await confluenceGet<PageListResponse>(as, route`/wiki/api/v2/pages?id=${batch}&body-format=storage&limit=${PAGE_BATCH}`, as === 'app' ? 'confluence-pages' : 'confluence-visibility');
    base = base ?? data._links?.base;
    pages.push(...(data.results ?? []));
  }
  return { pages, base };
}

/** Fallback: the most recently modified pages in the configured spaces, with bodies, as the app. */
async function recentCandidates(spaceKeys: string[]): Promise<{ candidates: Candidate[]; base?: string }> {
  const spaces = await confluenceGet<{ results?: { id?: string }[] }>('app', route`/wiki/api/v2/spaces?keys=${spaceKeys.join(',')}&limit=${spaceKeys.length}`, 'confluence-spaces');
  const candidates: Candidate[] = [];
  let base: string | undefined;
  const perSpace = Math.max(1, Math.floor(MAX_ARTICLE_CANDIDATES / Math.max(1, (spaces.results ?? []).length)));
  for (const s of spaces.results ?? []) {
    if (!s.id || !PAGE_ID.test(s.id)) continue;
    const data = await confluenceGet<PageListResponse>('app', route`/wiki/api/v2/spaces/${s.id}/pages?sort=-modified-date&body-format=storage&limit=${perSpace}`, 'confluence-recent');
    base = base ?? data._links?.base;
    for (const p of data.results ?? []) {
      if (!p.id || !PAGE_ID.test(p.id)) continue;
      candidates.push({ id: p.id, title: p.title ?? p.id, labels: [], updatedAt: p.version?.createdAt ?? '', webui: p._links?.webui, body: p.body?.storage?.value ?? '' });
    }
  }
  return { candidates, base };
}

/**
 * Knowledge articles related to the ticket, ranked per spec §9 (§9.3 status 0.2, §9.4 recency from
 * updatedAt, §9.5 authority by kind). Hybrid search: CQL first; nothing found or a CQL failure falls back
 * to listing recent pages. Returns [] when no spaces are configured. Throws only if both paths fail, so
 * the builder can mark the section as failed (spec §8.3).
 */
export async function searchArticles(ticket: Ticket, settings: RetrievalSettings, now: Date = new Date()): Promise<Article[]> {
  const spaces = settings.confluenceSpaces ?? [];
  const keywords = extractKeywords(ticket.summary, ticket.description);
  const cql = articleCql(spaces, keywords);
  if (!cql) return [];

  let path = 'cql';
  let found: { candidates: Candidate[]; base?: string } = { candidates: [] };
  try {
    found = await searchCandidates(cql);
  } catch (err) {
    console.warn(`articles for ${ticket.key || 'query'}: CQL search failed (${(err as Error).message}), listing recent pages instead`);
  }
  if (found.candidates.length === 0) {
    path = 'recent-pages';
    found = await recentCandidates(spaces);
  } else {
    // CQL results carry no bodies: fetch them in one batch, as the app.
    const { pages, base } = await pagesById('app', found.candidates.map((c) => c.id));
    const bodies = new Map((pages ?? []).map((p) => [p.id, p.body?.storage?.value ?? '']));
    found = { base: found.base ?? base, candidates: found.candidates.filter((c) => bodies.has(c.id)).map((c) => ({ ...c, body: bodies.get(c.id) })) };
  }
  const base = await wikiBase(found.base);

  const texts = new Map(found.candidates.map((c) => [c.id, storageToText(c.body ?? '')]));
  const scores = scoreArticleCandidates(keywords, new Map(found.candidates.map((c) => [c.id, `${c.title}\n${texts.get(c.id)}`])));
  const keep = relatedArticleIds(scores);
  const scored = found.candidates
    .filter((c) => keep.has(c.id))
    .map((c) => ({ c, text: texts.get(c.id) ?? '', kind: articleKind(c.labels, c.title), overlap: scores.get(c.id) ?? 0 }));
  console.log(`articles for ${ticket.key || 'query'}: ${path}, ${found.candidates.length} candidate(s), ${scored.length} related`);

  return rank(scored.map((s) => ({ item: s, sourceKey: `confluence-page:${s.c.id}`, components: articleComponents(s.kind, s.c.updatedAt, s.overlap, now) })))
    .slice(0, MAX_ARTICLE_RESULTS)
    .map(({ item: s }) => ({
      source: { kind: 'confluence-page', id: s.c.id, url: s.c.webui ? `${base}${s.c.webui}` : base, title: s.c.title, updatedAt: s.c.updatedAt },
      excerpt: excerpt(s.text, ARTICLE_EXCERPT_CHARS),
      kind: s.kind,
      relevance: s.overlap,
    }));
}

// ---- Read time, as the viewer ----

/**
 * The cited or listed Confluence pages the CURRENT VIEWER can see, with their current text, from one
 * batch fetch per PAGE_BATCH IDs run AS THE VIEWER. Pages the viewer cannot see, deleted pages and invalid
 * IDs are simply absent. Keys are "confluence-page:<id>", the verifier's source keys. Throws on failure;
 * callers must treat that as "not visible" (spec §16.5).
 */
export async function liveArticleTexts(ids: string[]): Promise<Map<string, LiveSource>> {
  const { pages, base } = await pagesById('user', ids);
  const wiki = await wikiBase(base);
  const live = new Map<string, LiveSource>();
  for (const p of pages ?? []) {
    if (!p.id) continue;
    const title = p.title ?? p.id;
    const ref: SourceRef = { kind: 'confluence-page', id: p.id, url: p._links?.webui ? `${wiki}${p._links.webui}` : wiki, title, updatedAt: p.version?.createdAt ?? '' };
    live.set(`confluence-page:${p.id}`, { ref, text: `${title}\n${storageToText(p.body?.storage?.value ?? '')}` });
  }
  return live;
}
