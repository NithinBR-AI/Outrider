// Mandatory revoked-access test (spec §19.5). Release blocker.
//
// Jira-only scope: the restricted source is a past resolution in ITO, exactly the situation set up
// on the demo site (user B is an ITS agent; ITO access can be granted and removed).
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
}));

import { getPanelContext } from '../../src/resolvers/panel';

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
