// Read-time filtering tests (spec §16.4, §16.5).
import { describe, expect, it } from 'vitest';
import { AUTH_CONFLUENCE_CHECK_FAILED, AUTH_JIRA_CHECK_FAILED, bundlePageIds, bundleSourceKeys, citedJiraKeys, filterBundleForViewer, withFailure, withVerifiedSummary } from '../authorize';
import { ContextBundle, Incident, Resolution } from '../types';

const ref = (id: string, kind: 'jira-issue' | 'confluence-page' = 'jira-issue') => ({ kind, id, url: `https://x/${id}`, title: id, updatedAt: 'u' });
const incident = (id: string): Incident => ({ source: ref(id), status: 'active', summary: `secret text of ${id}`, relevance: 0.5 });
const resolution = (id: string): Resolution => ({ source: ref(id), resolvedAt: 't', resolutionText: `fix for ${id}`, matchReason: 'same-symptom', relevance: 0.5 });

const stored = (overrides: Partial<ContextBundle> = {}): ContextBundle => ({
  ticketKey: 'ITS-1',
  builtAt: '2026-11-21T10:00:00.000Z',
  buildId: 'b1',
  ticketFingerprint: 'fp',
  incidents: [incident('ITO-1'), incident('ITS-2')],
  resolutions: [resolution('ITO-3'), resolution('ITS-4')],
  articles: [],
  services: [],
  partial: false,
  failures: [],
  ...overrides,
});

describe('bundleSourceKeys', () => {
  it('lists every Jira source key once, excluding non-Jira sources', () => {
    const b = stored({ incidents: [incident('ITO-1'), incident('ITO-1')], resolutions: [resolution('ITS-4'), { ...resolution('PAGE-1'), source: ref('123', 'confluence-page') }] });
    expect(bundleSourceKeys(b)).toEqual(['ITO-1', 'ITS-4']);
  });

  it('tolerates bundles without sections', () => {
    expect(bundleSourceKeys({ ticketKey: 'ITS-1' } as ContextBundle)).toEqual([]);
  });
});

describe('filterBundleForViewer', () => {
  it('keeps only the sources the viewer can see', () => {
    const out = filterBundleForViewer(stored(), new Set(['ITS-1', 'ITS-2', 'ITS-4']));
    expect(out.incidents.map((i) => i.source.id)).toEqual(['ITS-2']);
    expect(out.resolutions.map((r) => r.source.id)).toEqual(['ITS-4']);
  });

  it('leaves no trace of filtered sources: no text, no keys, no partial flag', () => {
    const out = filterBundleForViewer(stored(), new Set(['ITS-1']));
    const json = JSON.stringify(out);
    for (const hidden of ['ITO-1', 'ITO-3', 'ITS-2', 'ITS-4', 'secret text', 'fix for']) expect(json).not.toContain(hidden);
    expect(out.partial).toBe(false);
    expect(out.failures).toEqual([]);
    expect(out.incidents).toEqual([]);
    expect(out.resolutions).toEqual([]);
  });

  it('is indistinguishable from a bundle that never had those sources', () => {
    const filtered = filterBundleForViewer(stored(), new Set(['ITS-1']));
    const empty = filterBundleForViewer(stored({ incidents: [], resolutions: [] }), new Set(['ITS-1']));
    expect(filtered).toEqual(empty);
  });

  it('drops every Jira source and records auth:jira-check-failed when the check failed', () => {
    const out = filterBundleForViewer(stored(), null);
    expect(out.incidents).toEqual([]);
    expect(out.resolutions).toEqual([]);
    expect(out.partial).toBe(true);
    expect(out.failures).toEqual([AUTH_JIRA_CHECK_FAILED]);
  });

  it('does not invent a check failure when there was nothing to check', () => {
    const out = filterBundleForViewer(stored({ incidents: [], resolutions: [] }), null);
    expect(out.partial).toBe(false);
    expect(out.failures).toEqual([]);
  });

  it('keeps build-time failures and stays partial for them', () => {
    const out = filterBundleForViewer(stored({ partial: true, failures: ['jira-resolutions'] }), new Set(['ITS-2']));
    expect(out.failures).toEqual(['jira-resolutions']);
    expect(out.partial).toBe(true);
  });

  it('never serves unchecked sections or summaries: articles without a page check, services, stored claims', () => {
    const b = stored({
      articles: [{ source: ref('123', 'confluence-page'), excerpt: 'page text', kind: 'runbook', relevance: 0.5 }],
      services: [{ serviceName: 'Online Sales', relationship: 'affected-by', evidence: 'e', resolvedForAccountId: 'a' }],
      summary: { generatedClaims: [{ claimId: 'c1', text: 'claim', citedSourceRef: null }] },
    });
    const out = filterBundleForViewer(b, new Set(['ITS-1', 'ITO-1', 'ITS-2', 'ITO-3', 'ITS-4', '123']));
    expect(out.articles).toEqual([]);
    expect(out.services).toEqual([]);
    expect(out.summary).toBeUndefined();
  });

  describe('Confluence articles (step 10)', () => {
    const article = (id: string) => ({ source: ref(id, 'confluence-page'), excerpt: `${id} text`, kind: 'runbook' as const, relevance: 0.5 });
    const withArticles = () => stored({ articles: [article('4194312'), article('4292631')] });

    it('keeps only the pages the viewer can see, without a trace of the rest', () => {
      const out = filterBundleForViewer(withArticles(), new Set(['ITS-1']), new Set(['4194312']));
      expect(out.articles.map((a) => a.source.id)).toEqual(['4194312']);
      expect(out.partial).toBe(false);
      expect(JSON.stringify(out)).not.toContain('4292631');
    });

    it('a viewer who can see no page gets an empty section, same as a genuinely empty one', () => {
      const out = filterBundleForViewer(withArticles(), new Set(['ITS-1']), new Set());
      expect(out.articles).toEqual([]);
      expect(out).toEqual(filterBundleForViewer(stored({ articles: [] }), new Set(['ITS-1']), new Set()));
    });

    it('a failed page check drops every article and records auth:confluence-check-failed', () => {
      const out = filterBundleForViewer(withArticles(), new Set(['ITS-1', 'ITO-1', 'ITS-2']), null);
      expect(out.articles).toEqual([]);
      expect(out.failures).toEqual([AUTH_CONFLUENCE_CHECK_FAILED]);
      expect(out.partial).toBe(true);
      expect(filterBundleForViewer(stored({ articles: [] }), new Set(), null).failures).toEqual([]); // nothing to hide, no failure
      // A bundle stored before step 10 has no articles field at all: nothing to hide either.
      const old = filterBundleForViewer({ ...stored(), articles: undefined as never }, new Set(), null);
      expect(old.articles).toEqual([]);
      expect(old.failures).toEqual([]);
    });

    it('never treats a Jira key as a visible page, or a page ID as a visible Jira key', () => {
      const b = stored({ articles: [{ ...article('ITS-1'), source: ref('ITS-1', 'jira-issue') }] });
      expect(filterBundleForViewer(b, new Set(['ITS-1']), new Set(['ITS-1'])).articles).toEqual([]);
    });

    it('bundlePageIds lists every page the bundle would reveal: articles and pages the summary cites', () => {
      const b = stored({
        articles: [article('1'), article('2')],
        summary: { generatedClaims: [
          { claimId: 'a', text: 'x', citedSourceRef: ref('3', 'confluence-page') },
          { claimId: 'b', text: 'y', citedSourceRef: ref('1', 'confluence-page') },
          { claimId: 'c', text: 'z', citedSourceRef: ref('ITO-1') },
          { claimId: 'd', text: 'w', citedSourceRef: null },
        ] },
      });
      expect(bundlePageIds(b)).toEqual(['1', '2', '3']);
      expect(bundlePageIds({ ...stored(), articles: undefined as never, summary: undefined })).toEqual([]);
    });

    it('withFailure adds a failure once and marks the response partial', () => {
      const v = filterBundleForViewer(stored(), new Set());
      const once = withFailure(v, AUTH_CONFLUENCE_CHECK_FAILED);
      expect(once).toMatchObject({ failures: [AUTH_CONFLUENCE_CHECK_FAILED], partial: true });
      expect(withFailure(once, AUTH_CONFLUENCE_CHECK_FAILED).failures).toEqual([AUTH_CONFLUENCE_CHECK_FAILED]);
    });
  });

  it('does not treat a Confluence page ID as a visible Jira key', () => {
    const b = stored({ incidents: [{ ...incident('ITS-9'), source: ref('ITS-9', 'confluence-page') }], resolutions: [] });
    expect(filterBundleForViewer(b, new Set(['ITS-9'])).incidents).toEqual([]);
  });

  it('returns a new object and does not modify the stored bundle', () => {
    const b = stored();
    const before = JSON.stringify(b);
    const out = filterBundleForViewer(b, new Set(['ITS-2']));
    expect(out).not.toBe(b);
    expect(JSON.stringify(b)).toBe(before);
  });

  it('keeps the bundle identity fields', () => {
    const out = filterBundleForViewer(stored(), new Set());
    expect(out).toMatchObject({ ticketKey: 'ITS-1', builtAt: '2026-11-21T10:00:00.000Z', buildId: 'b1', ticketFingerprint: 'fp' });
  });

  it('handles bundles stored before a section existed', () => {
    const out = filterBundleForViewer({ ticketKey: 'ITS-1', builtAt: 't', buildId: 'b', ticketFingerprint: '' } as ContextBundle, new Set(['ITS-1']));
    expect(out.incidents).toEqual([]);
    expect(out.failures).toEqual([]);
  });
});

describe('citedJiraKeys', () => {
  it('lists the Jira keys a summary cites, once each, skipping uncited and non-Jira claims', () => {
    const summary = {
      generatedClaims: [
        { claimId: 'a', text: 'a', citedSourceRef: ref('ITO-1') },
        { claimId: 'b', text: 'b', citedSourceRef: ref('ITO-1') },
        { claimId: 'c', text: 'c', citedSourceRef: null },
        { claimId: 'd', text: 'd', citedSourceRef: ref('4194312', 'confluence-page') },
      ],
    };
    expect(citedJiraKeys(summary)).toEqual(['ITO-1']);
    expect(citedJiraKeys(undefined)).toEqual([]);
  });
});

describe('withVerifiedSummary', () => {
  const viewer = () => filterBundleForViewer(stored({ incidents: [], resolutions: [] }), new Set(['ITS-1']));
  const summary = (origin?: 'llm') => ({
    origin,
    generatedClaims: [
      { claimId: '1', text: 'We renewed certificate via Let\'s Encrypt', citedSourceRef: ref('ITO-1') },
      { claimId: '2', text: 'A made up claim about payments', citedSourceRef: ref('ITO-1') },
    ],
  });
  const live = new Map([['jira-issue:ITO-1', { ref: ref('ITO-1'), text: 'Root cause: we renewed certificate via Let\'s Encrypt.' }]]);

  it('attaches the verified claims and rejections, with the origin', () => {
    const out = withVerifiedSummary(viewer(), summary('llm'), live);
    expect(out.summary!.claims.map((c) => c.text)).toEqual(['We renewed certificate via Let\'s Encrypt']);
    expect(out.summary!.rejected).toEqual([{ text: 'A made up claim about payments', reason: 'no-matching-span' }]);
    expect(out.summary!.origin).toBe('llm');
    expect(out.partial).toBe(false);
  });

  it('attaches nothing when there is no stored summary or it has no claims', () => {
    expect(withVerifiedSummary(viewer(), undefined, live).summary).toBeUndefined();
    expect(withVerifiedSummary(viewer(), { generatedClaims: [] }, live).summary).toBeUndefined();
    // A stored summary missing its claims entirely (for example, written by an older version).
    expect(withVerifiedSummary(viewer(), {} as { generatedClaims: [] }, live).summary).toBeUndefined();
  });

  it('omits the summary entirely when no claim survives, even if some were rejected', () => {
    const out = withVerifiedSummary(viewer(), summary(), new Map([['jira-issue:ITO-1', { ref: ref('ITO-1'), text: 'unrelated text' }]]));
    expect(out).not.toHaveProperty('summary');
  });

  it('omits the summary when the viewer cannot see any cited source', () => {
    expect(withVerifiedSummary(viewer(), summary(), new Map())).not.toHaveProperty('summary');
  });

  it('shows no claims and marks the response partial when the live fetch failed', () => {
    const out = withVerifiedSummary(viewer(), summary(), null);
    expect(out).not.toHaveProperty('summary');
    expect(out.partial).toBe(true);
    expect(out.failures).toEqual([AUTH_JIRA_CHECK_FAILED]);
  });

  it('does not record the failure twice', () => {
    const v = filterBundleForViewer(stored(), null); // already has the failure from the source check
    expect(withVerifiedSummary(v, summary(), null).failures).toEqual([AUTH_JIRA_CHECK_FAILED]);
  });

  it('does not mark a failed fetch when nothing needed fetching', () => {
    const uncited = { generatedClaims: [{ claimId: 'x', text: 'x', citedSourceRef: null }] };
    const out = withVerifiedSummary(viewer(), uncited, null);
    expect(out.partial).toBe(false);
    expect(out).not.toHaveProperty('summary');
  });

  it('never carries a summary over from its input', () => {
    const withStale = { ...viewer(), summary: { claims: [], rejected: [] } };
    expect(withVerifiedSummary(withStale, undefined, live)).not.toHaveProperty('summary');
  });
});