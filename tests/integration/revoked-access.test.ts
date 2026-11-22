// Mandatory revoked-access test (spec §19.5). Release blocker.
//
// Two scopes. Jira: the restricted source is a past resolution in ITO, exactly the situation set up on the demo
// site (user B is an ITS agent; ITO access can be granted and removed). Confluence (step 10): the restricted
// source is a runbook page, with a summary claim citing it.
// 1. The user reads a bundle containing the restricted excerpt.
// 2. Their access to that source is revoked. The stored bundle is NOT rebuilt.
// 3. The user reads the same bundle again: the restricted excerpt is absent,
//    and still-authorized context remains.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextBundle } from '../../src/domain/types';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  canSee: new Set<string>(),
}));

// Teamwork Graph (step 11): no linked teams unless a test says otherwise; tests/integration/teams-authorization.test.ts covers teams.
vi.mock('../../src/adapters/twg', () => ({ teamsForProjects: async (keys: string[]) => new Map(keys.map((key) => [key, []])) }));
vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => structuredClone(h.store.get(key)),
    set: async (key: string, value: unknown) => void h.store.set(key, structuredClone(value)),
    delete: async (key: string) => void h.store.delete(key),
  },
}));
vi.mock('@forge/resolver', () => ({ default: class { define() {} getDefinitions() { return {}; } } }));
vi.mock('../../src/adapters/jira', () => ({
  visibleIssueKeys: async (keys: string[]) => new Set(keys.filter((k) => h.canSee.has(k))),
  liveSourceTexts: async () => new Map(),
}));
// The viewer's batch page fetch (step 10): only pages this viewer may see right now, with their current text.
vi.mock('../../src/adapters/confluence', () => ({
  liveArticleTexts: async (ids: string[]) => {
    const out = new Map<string, { ref: { kind: 'confluence-page'; id: string; url: string; title: string; updatedAt: string }; text: string }>();
    for (const id of ids) {
      if (!h.canSee.has(`page:${id}`)) continue;
      out.set(`confluence-page:${id}`, { ref: { kind: 'confluence-page', id, url: `https://x/wiki/pages/${id}`, title: id, updatedAt: 'now' }, text: PAGE_TEXT[id] ?? '' });
    }
    return out;
  },
}));

import { getPanelContext } from '../../src/resolvers/panel';

// Confluence block (step 10): the restricted source is the VPN runbook in the ITO space; the Auth runbook stays visible.
const VPN_PAGE = '4292631';
const AUTH_PAGE = '4194312';
const RESTRICTED_PAGE_EXCERPT = 'VPN client shows connection timed out after 60 seconds.';
const ALLOWED_PAGE_EXCERPT = 'Check the SSL certificate on auth-lb-01 first.';
const PAGE_TEXT: Record<string, string> = {
  [VPN_PAGE]: `VPN Gateway Recovery Runbook\n${RESTRICTED_PAGE_EXCERPT}\nRestart the OpenVPN service on the gateway host.`,
  [AUTH_PAGE]: `Auth Service Troubleshooting Runbook\n${ALLOWED_PAGE_EXCERPT}`,
};
const pageRef = (id: string, title: string) => ({ kind: 'confluence-page' as const, id, url: `https://x/wiki/pages/${id}`, title, updatedAt: 't' });

const RESTRICTED_EXCERPT = 'Root cause: SSL certificate on auth-lb-01 expired at 02:00 UTC.';
const STILL_ALLOWED_EXCERPT = 'We reset the VPN today.';

const stored: ContextBundle = {
  ticketKey: 'ITS-6265',
  builtAt: '2026-11-21T10:00:00.000Z',
  buildId: 'b1',
  ticketFingerprint: 'fp',
  incidents: [],
  resolutions: [
    { source: { kind: 'jira-issue', id: 'ITO-9642', url: 'u1', title: 'SSL fix', updatedAt: 'u' }, resolvedAt: 't', resolutionText: RESTRICTED_EXCERPT, matchReason: 'both', relevance: 0.4 },
    { source: { kind: 'jira-issue', id: 'ITS-6258', url: 'u2', title: 'VPN fix', updatedAt: 'u' }, resolvedAt: 't', resolutionText: STILL_ALLOWED_EXCERPT, matchReason: 'same-symptom', relevance: 0.3 },
  ],
  articles: [],
  services: [],
  partial: false,
  failures: [],
};

beforeEach(() => {
  h.store.clear();
  h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], affectedServicesField: 'customfield_10039', requestTypeField: 'customfield_10010', savedAt: 't' }); // explicit site settings (Phase 5.5)
  h.store.set('bundle:ITS-6265', stored);
  h.store.set('status:ITS-6265', { ticketKey: 'ITS-6265', buildId: 'b1', requestedAt: 'r', status: 'complete', actor: { source: 'jira-event' } });
  h.canSee = new Set(['ITS-6265', 'ITO-9642', 'ITS-6258']);
});

describe('revoked access (spec §19.5)', () => {
  it('drops the restricted excerpt on the next read after access is revoked, without a rebuild', async () => {
    // 1. Initial read: the user can see the restricted source.
    const before = JSON.stringify(await getPanelContext('ITS-6265'));
    expect(before).toContain(RESTRICTED_EXCERPT);
    expect(before).toContain(STILL_ALLOWED_EXCERPT);

    // 2. Access to ITO-9642 is revoked. The stored bundle is left exactly as it was.
    h.canSee.delete('ITO-9642');
    expect(JSON.stringify(h.store.get('bundle:ITS-6265'))).toContain(RESTRICTED_EXCERPT);

    // 3. Same user, same stored bundle, next read.
    const after = await getPanelContext('ITS-6265');
    const json = JSON.stringify(after);
    expect(json).not.toContain(RESTRICTED_EXCERPT); // 4. restricted excerpt absent
    expect(json).not.toContain('ITO-9642');
    expect(json).toContain(STILL_ALLOWED_EXCERPT); // 5. other authorized context remains
    expect(after.state).toBe('complete');
  });

  it('restores the source when access is granted again', async () => {
    h.canSee.delete('ITO-9642');
    expect(JSON.stringify(await getPanelContext('ITS-6265'))).not.toContain(RESTRICTED_EXCERPT);
    h.canSee.add('ITO-9642');
    expect(JSON.stringify(await getPanelContext('ITS-6265'))).toContain(RESTRICTED_EXCERPT);
  });

  it('revoking access to the ticket itself removes everything', async () => {
    h.canSee.delete('ITS-6265');
    expect(await getPanelContext('ITS-6265')).toEqual({ state: 'unavailable' });
  });
});

// Release blocker as listed in CLAUDE.md: "User reads a bundle. User loses access to a Confluence page. User reads again.
// Restricted excerpt must be absent." Same flow as above, for a knowledge article and a summary claim citing it.
describe('revoked access to a Confluence page (spec §19.5, step 10)', () => {
  const withPages: ContextBundle = {
    ...stored,
    resolutions: [],
    articles: [
      { source: pageRef(VPN_PAGE, 'VPN Gateway Recovery Runbook'), excerpt: RESTRICTED_PAGE_EXCERPT, kind: 'runbook', relevance: 0.4 },
      { source: pageRef(AUTH_PAGE, 'Auth Service Troubleshooting Runbook'), excerpt: ALLOWED_PAGE_EXCERPT, kind: 'runbook', relevance: 0.5 },
    ],
    summary: {
      origin: 'llm',
      promptHash: 'h',
      generatedClaims: [
        { claimId: 'vpn', text: 'Restart the OpenVPN service on the gateway host.', citedSourceRef: pageRef(VPN_PAGE, 'VPN Gateway Recovery Runbook') },
        { claimId: 'auth', text: ALLOWED_PAGE_EXCERPT, citedSourceRef: pageRef(AUTH_PAGE, 'Auth Service Troubleshooting Runbook') },
      ],
    },
  };

  beforeEach(() => {
    h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], confluenceSpaces: ['ITO'], savedAt: 't' });
    h.store.set('bundle:ITS-6265', withPages);
    h.canSee = new Set(['ITS-6265', `page:${VPN_PAGE}`, `page:${AUTH_PAGE}`]);
  });

  it('drops the restricted page excerpt and the claim citing it on the next read, without a rebuild', async () => {
    // 1. Initial read: the user can see both runbooks, and both claims are shown.
    const before = JSON.stringify(await getPanelContext('ITS-6265'));
    expect(before).toContain(RESTRICTED_PAGE_EXCERPT);
    expect(before).toContain('Restart the OpenVPN service');

    // 2. Access to the VPN runbook is revoked. The stored bundle is left exactly as it was.
    h.canSee.delete(`page:${VPN_PAGE}`);
    expect(JSON.stringify(h.store.get('bundle:ITS-6265'))).toContain(RESTRICTED_PAGE_EXCERPT);

    // 3. Same user, same stored bundle, next read.
    const after = await getPanelContext('ITS-6265');
    const json = JSON.stringify(after);
    expect(json).not.toContain(RESTRICTED_PAGE_EXCERPT); // 4. restricted excerpt absent
    expect(json).not.toContain('Restart the OpenVPN service'); // the claim citing it is omitted, not rejected
    expect(json).not.toContain(VPN_PAGE);
    expect(json).toContain(ALLOWED_PAGE_EXCERPT); // 5. other authorized context remains
    expect(after.state).toBe('complete');
  });

  it('restores the page when access is granted again', async () => {
    h.canSee.delete(`page:${VPN_PAGE}`);
    expect(JSON.stringify(await getPanelContext('ITS-6265'))).not.toContain(RESTRICTED_PAGE_EXCERPT);
    h.canSee.add(`page:${VPN_PAGE}`);
    expect(JSON.stringify(await getPanelContext('ITS-6265'))).toContain(RESTRICTED_PAGE_EXCERPT);
  });
});
