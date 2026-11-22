// Confluence adapter tests against responses recorded from the demo site (tests/fixtures/confluence-demo-site.json):
// the ITS-6265 login ticket (its recorded text, tests/fixtures/jira-demo-site.json), the ITO space with the three seeded runbooks, older post-mortems and known-error
// pages. No live calls (§19.7).
import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'confluence-demo-site.json'), 'utf8'));
const jira: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'jira-demo-site.json'), 'utf8'));

const h = vi.hoisted(() => ({
  calls: [] as { as: 'app' | 'user'; path: string }[],
  searchMode: 'ok' as 'ok' | 'empty' | 'fail',
  failRecent: false,
  failUserPages: false,
  userCanSee: null as null | Set<string>, // null: sees everything
  base: undefined as string | undefined, // overrides _links.base
}));

vi.mock('@forge/api', () => {
  const respond = (status: number, json: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  const withBase = (json: any) => (h.base ? { ...json, _links: { ...(json._links ?? {}), base: h.base } } : json);
  const confluence = (as: 'app' | 'user') => async (path: string) => {
    h.calls.push({ as, path });
    if (path.startsWith('/wiki/rest/api/search')) {
      if (h.searchMode === 'fail') return respond(500, {});
      return respond(200, withBase(h.searchMode === 'empty' ? { results: [], _links: fixture.search._links } : fixture.search));
    }
    const byId = /^\/wiki\/api\/v2\/pages\?id=([\d,]+)/.exec(path);
    if (byId) {
      if (as === 'user' && h.failUserPages) return respond(503, {});
      const ids = byId[1].split(',');
      const results = fixture.pagesById.results.filter((p: { id: string }) => ids.includes(p.id) && (as === 'app' || !h.userCanSee || h.userCanSee.has(p.id)));
      return respond(200, withBase({ results, _links: fixture.pagesById._links }));
    }
    if (path.startsWith('/wiki/api/v2/spaces?keys=')) return respond(200, fixture.space);
    if (/^\/wiki\/api\/v2\/spaces\/\d+\/pages/.test(path)) return h.failRecent ? respond(500, {}) : respond(200, withBase(fixture.recentPages));
    return respond(404, {});
  };
  return {
    route: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((a, x, i) => a + x + (i < v.length ? String(v[i]) : ''), ''),
    default: {
      asApp: () => ({ requestConfluence: confluence('app'), requestJira: async () => respond(200, { baseUrl: 'https://one-atlas-edlg.atlassian.net' }) }),
      asUser: () => ({ requestConfluence: confluence('user') }),
    },
  };
});

import { liveArticleTexts, searchArticles } from '../confluence';
import { clearSiteBaseCache } from '../jira';
import { MAX_ARTICLE_RESULTS } from '../../domain/articles';
import { adfToText } from '../../domain/extract';
import { RetrievalSettings } from '../../domain/settings';
import { Ticket } from '../../domain/types';

const SETTINGS: RetrievalSettings = { sourceProjects: ['ITS', 'ITO'], confluenceSpaces: ['ITO'] };
const LOGIN: Ticket = {
  key: 'ITS-6265',
  projectKey: 'ITS',
  summary: jira.ticket.fields.summary,
  description: adfToText(jira.ticket.fields.description),
  labels: [],
  serviceIds: [],
  status: 'Waiting for support',
  updatedAt: 'u',
};
const NOW = new Date('2026-11-22T00:00:00Z');
const ids = (articles: { source: { id: string } }[]) => articles.map((a) => a.source.id);

beforeEach(() => {
  h.calls = [];
  h.searchMode = 'ok';
  h.failRecent = false;
  h.failUserPages = false;
  h.userCanSee = null;
  h.base = undefined;
  clearSiteBaseCache();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('searchArticles (build time, as the app)', () => {
  it('finds the Auth runbook first for the login ticket, as a runbook with a site link and an excerpt', async () => {
    const articles = await searchArticles(LOGIN, SETTINGS, NOW);
    expect(articles[0].source).toMatchObject({ kind: 'confluence-page', id: '4194312', title: 'Auth Service Troubleshooting Runbook' });
    expect(articles[0].source.url).toMatch(/^https:\/\/one-atlas-edlg\.atlassian\.net\/wiki\/spaces\/ITO\/pages\/4194312/);
    expect(articles[0].kind).toBe('runbook');
    expect(articles[0].excerpt.length).toBeGreaterThan(0);
    expect(articles[0].excerpt.length).toBeLessThanOrEqual(601);
    expect(articles[0].relevance).toBeGreaterThan(0);
  });

  it('runs entirely as the app: one CQL search, then one batch body fetch', async () => {
    await searchArticles(LOGIN, SETTINGS, NOW);
    expect(h.calls.map((c) => c.as)).toEqual(['app', 'app']);
    expect(h.calls[0].path).toContain('space in ("ITO") AND type = page AND (text ~ "');
    expect(h.calls[1].path).toMatch(/^\/wiki\/api\/v2\/pages\?id=/);
  });

  it('keeps only the related runbook for the login ticket: the other runbooks matched only "log" and "page"', async () => {
    const articles = await searchArticles(LOGIN, SETTINGS, NOW);
    expect(ids(articles)).toEqual(['4194312']);
    expect(articles.length).toBeLessThanOrEqual(MAX_ARTICLE_RESULTS);
    for (const a of articles) expect(a.relevance).toBeGreaterThanOrEqual(0.2);
  });

  it('falls back to listing recent pages when CQL finds nothing (for example right after space access is granted)', async () => {
    h.searchMode = 'empty';
    const articles = await searchArticles(LOGIN, SETTINGS, NOW);
    expect(h.calls.map((c) => c.path.split('?')[0])).toEqual(['/wiki/rest/api/search', '/wiki/api/v2/spaces', '/wiki/api/v2/spaces/1572871/pages']);
    expect(ids(articles)).toContain('4194312');
    expect(articles.find((a) => a.source.id === '4194312')!.kind).toBe('runbook'); // from the title: the listing has no labels
  });

  it('falls back the same way when CQL fails', async () => {
    h.searchMode = 'fail';
    expect(ids(await searchArticles(LOGIN, SETTINGS, NOW))).toContain('4194312');
  });

  it('throws when both paths fail, so the builder marks the section as failed', async () => {
    h.searchMode = 'fail';
    h.failRecent = true;
    await expect(searchArticles(LOGIN, SETTINGS, NOW)).rejects.toThrow('confluence-recent-500');
  });

  it('makes no call when no spaces are configured', async () => {
    expect(await searchArticles(LOGIN, { sourceProjects: ['ITS'] }, NOW)).toEqual([]);
    expect(await searchArticles(LOGIN, { sourceProjects: ['ITS'], confluenceSpaces: [] }, NOW)).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('is deterministic for a fixed clock', async () => {
    expect(await searchArticles(LOGIN, SETTINGS, NOW)).toEqual(await searchArticles(LOGIN, SETTINGS, NOW));
  });

  it('builds links from the site URL even if Confluence reports the API gateway as its base', async () => {
    h.base = 'https://api.atlassian.com/ex/confluence/cloud-1/wiki';
    const [first] = await searchArticles(LOGIN, SETTINGS, NOW);
    expect(first.source.url.startsWith('https://one-atlas-edlg.atlassian.net/wiki/')).toBe(true);
  });
});

describe('liveArticleTexts (read time, as the viewer)', () => {
  it('runs as the viewer and returns each visible page with its current text and a site link', async () => {
    const live = await liveArticleTexts(['4194312', '4292631']);
    expect(h.calls).toEqual([{ as: 'user', path: expect.stringMatching(/^\/wiki\/api\/v2\/pages\?id=4194312,4292631&body-format=storage/) }]);
    const auth = live.get('confluence-page:4194312')!;
    expect(auth.ref).toMatchObject({ kind: 'confluence-page', id: '4194312', title: 'Auth Service Troubleshooting Runbook' });
    expect(auth.text.startsWith('Auth Service Troubleshooting Runbook\n')).toBe(true);
    expect(auth.text).not.toMatch(/<[a-z]/i);
  });

  it('leaves out pages the viewer cannot see, without an error (user B on the demo site)', async () => {
    h.userCanSee = new Set();
    expect((await liveArticleTexts(['4194312', '4292631'])).size).toBe(0);
    h.userCanSee = new Set(['4292631']);
    expect([...(await liveArticleTexts(['4194312', '4292631'])).keys()]).toEqual(['confluence-page:4292631']);
  });

  it('never sends values that are not page IDs, and makes no call for none', async () => {
    expect((await liveArticleTexts(['abc', '1) OR 1=1', ''])).size).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it('throws a short code when the check fails, so callers can fail closed', async () => {
    h.failUserPages = true;
    await expect(liveArticleTexts(['4194312'])).rejects.toThrow('confluence-visibility-503');
  });
});
