// Read-time authorization for Confluence knowledge articles (step 10; spec §16, security tests #1 and #3 for
// Confluence). Runs the real panel resolver, MCP tool, viewer filter and verifier against a stored bundle.
// Jira and Confluence are simulated as per-viewer permission tables, as on the demo site: user A sees ITS,
// ITO and the ITO runbooks; user B sees ITS only and no ITO space (knowledge-base access only).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextBundle, SourceRef, ViewerBundle } from '../../src/domain/types';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  viewer: '',
  canSee: {} as Record<string, string[]>,
  pageText: new Map<string, string>(),
  pageCheckFails: false,
  pageFetches: [] as string[][],
}));

// Teamwork Graph (step 11): no linked teams unless a test says otherwise; tests/integration/teams-authorization.test.ts covers teams.
vi.mock('../../src/adapters/twg', () => ({ teamsForProjects: async (keys: string[]) => ({ teams: new Map(keys.map((key) => [key, []])), failed: [] }) }));
vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => structuredClone(h.store.get(key)),
    set: async (key: string, value: unknown) => void h.store.set(key, structuredClone(value)),
    delete: async (key: string) => void h.store.delete(key),
  },
}));
vi.mock('@forge/resolver', () => ({ default: class { define() {} getDefinitions() { return {}; } } }));
vi.mock('@forge/events', () => ({ Queue: class { push = async () => ({ jobId: 'j' }); } }));
vi.mock('../../src/adapters/jira', () => ({
  visibleIssueKeys: async (keys: string[]) => new Set(keys.filter((k) => (h.canSee[h.viewer] ?? []).includes(k))),
  liveSourceTexts: async () => new Map(),
}));
// The viewer's batch page fetch: only pages this viewer may see, with their CURRENT text.
vi.mock('../../src/adapters/confluence', () => ({
  liveArticleTexts: async (ids: string[]) => {
    h.pageFetches.push(ids);
    if (h.pageCheckFails) throw new Error('confluence-visibility-503');
    const out = new Map<string, { ref: SourceRef; text: string }>();
    for (const id of ids) {
      if (!(h.canSee[h.viewer] ?? []).includes(`page:${id}`)) continue;
      out.set(`confluence-page:${id}`, { ref: { kind: 'confluence-page', id, url: `https://one-atlas-edlg.atlassian.net/wiki/spaces/ITO/pages/${id}`, title: `${id} live`, updatedAt: 'now' }, text: h.pageText.get(id) ?? '' });
    }
    return out;
  },
}));

import { getPanelContext } from '../../src/resolvers/panel';
import { getTicketContext } from '../../src/mcp/tools';
import { AUTH_CONFLUENCE_CHECK_FAILED } from '../../src/domain/authorize';

const AUTH_RUNBOOK = '4194312';
const VPN_RUNBOOK = '4292631';
const page = (id: string, title: string): SourceRef => ({ kind: 'confluence-page', id, url: `https://one-atlas-edlg.atlassian.net/wiki/spaces/ITO/pages/${id}`, title, updatedAt: 't' });
const AUTH_TEXT = 'Auth Service Troubleshooting Runbook\nSymptoms\nUsers see a generic error message on the login page.\nCheck the SSL certificate on auth-lb-01 first.';

const stored: ContextBundle = {
  ticketKey: 'ITS-6265',
  builtAt: '2026-11-22T10:00:00.000Z',
  buildId: 'b1',
  ticketFingerprint: 'fp',
  incidents: [],
  resolutions: [],
  articles: [
    { source: page(AUTH_RUNBOOK, 'Auth Service Troubleshooting Runbook'), excerpt: 'Users see a generic error message on the login page. (restricted ITO text)', kind: 'runbook', relevance: 0.5 },
    { source: page(VPN_RUNBOOK, 'VPN Gateway Recovery Runbook'), excerpt: 'VPN client shows connection timed out. (restricted ITO text)', kind: 'runbook', relevance: 0.3 },
  ],
  services: [],
  partial: false,
  failures: [],
  summary: {
    origin: 'llm',
    promptHash: 'h',
    generatedClaims: [
      { claimId: 'c1', text: 'Check the SSL certificate on auth-lb-01 first.', citedSourceRef: page(AUTH_RUNBOOK, 'Auth Service Troubleshooting Runbook') },
      { claimId: 'c2', text: 'Users see a generic error message on the login page.', citedSourceRef: page(AUTH_RUNBOOK, 'Auth Service Troubleshooting Runbook') },
      { claimId: 'c3', text: 'Restarting the payroll service fixes every login problem.', citedSourceRef: page(AUTH_RUNBOOK, 'Auth Service Troubleshooting Runbook') },
    ],
  },
};

const panel = async (viewer: string) => {
  h.viewer = viewer;
  const s = await getPanelContext('ITS-6265');
  return (s as { bundle?: ViewerBundle }).bundle!;
};

beforeEach(() => {
  h.store.clear();
  h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], confluenceSpaces: ['ITO'], savedAt: 't' });
  h.store.set('bundle:ITS-6265', stored);
  h.store.set('status:ITS-6265', { ticketKey: 'ITS-6265', buildId: 'b1', requestedAt: 'r', status: 'complete', actor: { source: 'jira-event' } });
  h.canSee = {
    userA: ['ITS-6265', `page:${AUTH_RUNBOOK}`, `page:${VPN_RUNBOOK}`],
    userB: ['ITS-6265'],
  };
  h.pageText = new Map([[AUTH_RUNBOOK, AUTH_TEXT], [VPN_RUNBOOK, 'VPN Gateway Recovery Runbook\nVPN client shows connection timed out.']]);
  h.pageCheckFails = false;
  h.pageFetches = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('two-viewer article isolation (security test #1, Confluence)', () => {
  it('the same stored bundle shows user A both runbooks and user B none, with no trace', async () => {
    expect((await panel('userA')).articles.map((a) => a.source.id)).toEqual([AUTH_RUNBOOK, VPN_RUNBOOK]);
    const b = await panel('userB');
    expect(b.articles).toEqual([]);
    expect(b.partial).toBe(false);
    const json = JSON.stringify(b);
    for (const leak of [AUTH_RUNBOOK, VPN_RUNBOOK, 'restricted ITO text', 'Runbook', 'auth-lb-01']) expect(json).not.toContain(leak);
  });

  it('one batch fetch as the viewer covers the articles and the pages the summary cites', async () => {
    await panel('userA');
    expect(h.pageFetches).toEqual([[AUTH_RUNBOOK, VPN_RUNBOOK]]);
  });

  it('MCP get-ticket-context applies the same filter per caller', async () => {
    h.viewer = 'userA';
    expect(((await getTicketContext('ITS-6265')) as ViewerBundle).articles).toHaveLength(2);
    h.viewer = 'userB';
    const b = (await getTicketContext('ITS-6265')) as ViewerBundle;
    expect(b.articles).toEqual([]);
    expect(JSON.stringify(b)).not.toContain('restricted ITO text');
  });
});

describe('revoked access (security test #3, Confluence)', () => {
  it('user A losing access to the VPN runbook hides it on the next read, with the same stored bundle', async () => {
    expect((await panel('userA')).articles).toHaveLength(2);
    h.canSee.userA = ['ITS-6265', `page:${AUTH_RUNBOOK}`];
    const after = await panel('userA');
    expect(after.articles.map((a) => a.source.id)).toEqual([AUTH_RUNBOOK]);
    expect(JSON.stringify(after)).not.toContain('VPN client shows');
  });
});

describe('summary claims citing runbooks (verifier, §13.2)', () => {
  it('user A: claims matching the runbook live text are shown with the live link; the unsupported one is rejected', async () => {
    const s = (await panel('userA')).summary!;
    expect(s.claims.map((c) => c.text)).toEqual(['Check the SSL certificate on auth-lb-01 first.', 'Users see a generic error message on the login page.']);
    expect(s.claims[0].source).toMatchObject({ kind: 'confluence-page', id: AUTH_RUNBOOK, url: expect.stringContaining('/wiki/spaces/ITO/pages/4194312') });
    expect(s.rejected).toEqual([{ text: 'Restarting the payroll service fixes every login problem.', reason: 'no-matching-span' }]);
  });

  it('user B: no summary at all; claims citing a page B cannot see are omitted, not rejected', async () => {
    const b = await panel('userB');
    expect(b.summary).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain('payroll');
  });

  it('claims are checked against the page as it is now, not the stored excerpt', async () => {
    h.pageText.set(AUTH_RUNBOOK, 'Auth Service Troubleshooting Runbook\nThis page was rewritten; see the new on-call guide.');
    expect((await panel('userA')).summary).toBeUndefined(); // nothing matches the new text
  });
});

describe('a failed Confluence check (§16.5)', () => {
  it('drops every article and every claim citing a page, and marks the response partial', async () => {
    h.pageCheckFails = true;
    const a = await panel('userA');
    expect(a.articles).toEqual([]);
    expect(a.summary).toBeUndefined();
    expect(a.failures).toEqual([AUTH_CONFLUENCE_CHECK_FAILED]);
    expect(a.partial).toBe(true);
  });

  it('a bundle with no articles and no page citations makes no Confluence call and needs no check', async () => {
    h.store.set('bundle:ITS-6265', { ...stored, articles: [], summary: undefined });
    h.pageCheckFails = true;
    const a = await panel('userA');
    expect(h.pageFetches).toEqual([]);
    expect(a.failures).toEqual([]);
  });
});
