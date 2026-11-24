// Knowledge article rules (step 10). Pure. Storage-format samples are real recorded demo-site pages
// (tests/fixtures/confluence-demo-site.json).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { ARTICLE_RELATIVE_FLOOR, articleCql, articleKind, MAX_CQL_TERMS, MIN_ARTICLE_SCORE, relatedArticleIds, scoreArticleCandidates, storageToText } from '../articles';
import { adfToText, extractKeywords, keywordOverlap } from '../extract';
import { ARTICLE_AUTHORITY, ARTICLE_STATUS_WEIGHT, articleComponents, RECENCY_HALF_LIFE_DAYS } from '../score';

const fixture: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'confluence-demo-site.json'), 'utf8'));
const body = (id: string): string => fixture.pagesById.results.find((p: { id: string }) => p.id === id).body.storage.value;

describe('storageToText', () => {
  it('drops tags, keeps words from adjacent blocks apart, and decodes entities', () => {
    expect(storageToText('<h3>Overview</h3><p>VPN client shows &quot;connection timed out&quot; &amp; fails.</p><ul><li>One</li><li>Two</li></ul>')).toBe(
      'Overview\nVPN client shows "connection timed out" & fails.\nOne\nTwo',
    );
  });

  it('keeps code block text from CDATA and decodes numeric entities', () => {
    expect(storageToText('<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[nc -uvz vpn 1194]]></ac:plain-text-body></ac:structured-macro><p>a&#39;b &#x2014; c&nbsp;d</p>')).toBe(
      "nc -uvz vpn 1194\na'b — c d",
    );
  });

  it('leaves unknown entities as written, and handles empty input', () => {
    expect(storageToText('<p>x &foo; y</p>')).toBe('x &foo; y');
    expect(storageToText('')).toBe('');
    expect(storageToText(undefined as never)).toBe('');
  });

  it('turns the real VPN runbook into readable text the verifier can match', () => {
    const text = storageToText(body('4292631'));
    expect(text).toContain('This runbook covers diagnosis and recovery of the corporate VPN gateway (vpn.corp.internal).');
    expect(text).toContain('VPN client shows "connection timed out" after 60 seconds');
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text).not.toContain('&quot;');
  });
});

describe('articleKind', () => {
  it('comes from labels: runbook, then policy, else guide', () => {
    expect(articleKind(['runbook'])).toBe('runbook');
    expect(articleKind(['Policy', 'hr'])).toBe('policy');
    expect(articleKind(['known-error'])).toBe('guide');
    expect(articleKind(undefined as never)).toBe('guide');
  });

  it('falls back to the title only when the page has no labels (the page-listing fallback returns none)', () => {
    expect(articleKind([], 'VPN Gateway Recovery Runbook')).toBe('runbook');
    expect(articleKind([], 'Acceptable use policy')).toBe('policy');
    expect(articleKind([], 'Known Errors & Workarounds')).toBe('guide');
    expect(articleKind(['known-error'], 'Old runbook notes')).toBe('guide'); // labels win
  });
});

describe('articleCql', () => {
  const keywords = extractKeywords('Cannot log in - getting error on login page', 'I get a generic error message when I enter my credentials.');

  it('searches the configured spaces for any of the strongest keywords, summary words first', () => {
    const cql = articleCql(['ITO'], keywords)!;
    expect(cql.startsWith('space in ("ITO") AND type = page AND (text ~ "')).toBe(true);
    expect(cql).toContain('text ~ "login"');
    expect((cql.match(/text ~ "/g) ?? []).length).toBeLessThanOrEqual(MAX_CQL_TERMS);
    expect(cql.indexOf('text ~ "login"')).toBeLessThan(cql.indexOf('text ~ "credential"') === -1 ? Infinity : cql.indexOf('text ~ "credential"'));
  });

  it('lists several spaces once each and never lets a key or keyword break out of its quotes', () => {
    const cql = articleCql(['ITO', 'KB', 'ITO', 'x") OR space = "SECRET', '~600a7'], new Map([['vpn', 2], ['drop"s', 2], ['gateway', 1]]))!;
    expect(cql).toBe('space in ("ITO", "KB") AND type = page AND (text ~ "vpn" OR text ~ "gateway")');
  });

  it('returns nothing to search when there is no valid space or no usable keyword', () => {
    expect(articleCql([], keywords)).toBeUndefined();
    expect(articleCql(['bad key'], keywords)).toBeUndefined();
    expect(articleCql(['ITO'], new Map())).toBeUndefined();
    expect(articleCql(undefined as never, keywords)).toBeUndefined();
  });
});

describe('article scoring (spec §9.3-9.5)', () => {
  const now = new Date('2026-11-22T00:00:00Z');

  it('uses the spec values: status 0.2, authority runbook 1.0, policy 1.0, guide 0.7', () => {
    expect(ARTICLE_STATUS_WEIGHT).toBe(0.2);
    expect(ARTICLE_AUTHORITY).toEqual({ runbook: 1.0, policy: 1.0, guide: 0.7 });
    expect(articleComponents('guide', undefined, 0.4, now)).toEqual({ semantic: 0.4, relationship: 0, status: 0.2, recency: 0, authority: 0.7 });
  });

  it('takes recency from the page update time with the 30-day half-life', () => {
    const halfLifeAgo = new Date(now.getTime() - RECENCY_HALF_LIFE_DAYS * 86_400_000).toISOString();
    expect(articleComponents('runbook', halfLifeAgo, 0.5, now).recency).toBeCloseTo(0.5, 6);
  });

  it('on the real demo pages, plain overlap already ranks the Auth runbook above the VPN runbook for the login ticket', () => {
    const ticket = extractKeywords('Cannot log in - getting error on login page', 'Generic error message when I enter my credentials. The auth service seems down.');
    const auth = keywordOverlap(ticket, `Auth Service Troubleshooting Runbook\n${storageToText(body('4194312'))}`);
    const vpn = keywordOverlap(ticket, `VPN Gateway Recovery Runbook\n${storageToText(body('4292631'))}`);
    expect(auth).toBeGreaterThan(vpn);
  });
});

describe('rarity-weighted relevance (scoreArticleCandidates, relatedArticleIds)', () => {
  // The 13 pages the CQL search returned for ITS-6265 on the demo site, with their recorded bodies.
  const pages = new Map<string, string>(fixture.pagesById.results.map((p: { id: string; title: string; body: { storage: { value: string } } }) => [p.id, `${p.title}\n${storageToText(p.body.storage.value)}`]));
  const titleOf = (id: string) => fixture.pagesById.results.find((p: { id: string }) => p.id === id).title as string;
  const jira: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'jira-demo-site.json'), 'utf8'));
  const vpnTicket: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'jira-its-6267.json'), 'utf8'));
  const kept = (keywords: Map<string, number>) => {
    const scores = scoreArticleCandidates(keywords, pages);
    return [...relatedArticleIds(scores)].sort((a, b) => scores.get(b)! - scores.get(a)!).map(titleOf);
  };

  it('ITS-6265 (login): keeps only the Auth runbook; "log" and "page" no longer carry Logstash, Database or VPN', () => {
    expect(kept(extractKeywords(jira.ticket.fields.summary, adfToText(jira.ticket.fields.description)))).toEqual(['Auth Service Troubleshooting Runbook']);
  });

  it('ITS-6265 summary only: still only the Auth runbook (the other runbooks reach 55% of it, under the 60% floor)', () => {
    expect(kept(extractKeywords(jira.ticket.fields.summary, ''))).toEqual(['Auth Service Troubleshooting Runbook']);
  });

  it('ITS-6267 (VPN): ranks the VPN runbook first; the near-ties on "connect"/"connection" remain, as measured', () => {
    const titles = kept(extractKeywords(vpnTicket.summary, adfToText(vpnTicket.description)));
    expect(titles[0]).toBe('VPN Gateway Recovery Runbook');
    expect(new Set(titles)).toEqual(new Set(['VPN Gateway Recovery Runbook', 'Auth Service Troubleshooting Runbook', 'Database Connection Pool Troubleshooting']));
  });

  it('weights a word by how rare it is among the candidates', () => {
    const texts = new Map([['a', 'vpn gateway outage'], ['b', 'gateway reboot'], ['c', 'gateway disk']]);
    const s = scoreArticleCandidates(new Map([['vpn', 1], ['gateway', 1]]), texts);
    expect(s.get('a')!).toBeGreaterThan(s.get('b')!); // "vpn" is in one page, "gateway" in all three
    expect(s.get('b')).toBe(s.get('c'));
  });

  it('still scores a single candidate, and scores nothing without keywords or candidates', () => {
    expect(scoreArticleCandidates(new Map([['vpn', 2]]), new Map([['a', 'vpn runbook']])).get('a')).toBe(1);
    expect(scoreArticleCandidates(new Map(), new Map([['a', 'vpn']])).get('a')).toBe(0);
    expect(scoreArticleCandidates(new Map([['vpn', 1]]), new Map()).size).toBe(0);
  });

  it('ignores ticket keywords no candidate contains, so a long description does not hide the right runbook', () => {
    // Second site (2026-11-24): OD-2 against the three runbooks in its IKB space. Half of its 20 keywords
    // ("regions", "investigating", "utc", ...) appear in no page; counted in the denominator, they left the Auth
    // runbook at 0.18, below MIN_ARTICLE_SCORE, so the panel showed no article.
    const second: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'confluence-second-site.json'), 'utf8'));
    const keywords = extractKeywords(second.ticket.summary, second.ticket.description);
    const texts = new Map<string, string>(Object.entries(second.pages).map(([id, p]: [string, any]) => [id, `${p.title}\n${storageToText(p.storage)}`]));
    const scores = scoreArticleCandidates(keywords, texts);
    const title = (id: string) => second.pages[id].title;
    expect([...relatedArticleIds(scores)].map(title)).toEqual(['Auth Service Troubleshooting Runbook']);
    expect(scores.get('4030465')!).toBeGreaterThan(0.6);
    // The other two still fall well below the relative floor.
    for (const id of ['4161537', '4489217']) expect(scores.get(id)!).toBeLessThan(ARTICLE_RELATIVE_FLOOR * scores.get('4030465')!);
    // No keyword in any candidate: every score is 0, not NaN.
    expect([...scoreArticleCandidates(new Map([['zzzunmatched', 1]]), texts).values()]).toEqual([0, 0, 0]);
  });

  it('keeps candidates at or above both the minimum score and the relative floor', () => {
    expect(MIN_ARTICLE_SCORE).toBe(0.2);
    expect(ARTICLE_RELATIVE_FLOOR).toBe(0.6);
    const ids = relatedArticleIds(new Map([['top', 0.8], ['atFloor', 0.48], ['belowFloor', 0.47], ['belowMin', 0.19]]));
    expect([...ids]).toEqual(['top', 'atFloor']);
    expect(relatedArticleIds(new Map([['only', 0.19]])).size).toBe(0);
    expect(relatedArticleIds(new Map()).size).toBe(0);
  });
});
