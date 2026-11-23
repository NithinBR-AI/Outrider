// Clustering source adapter (step 13). Responses use the shapes recorded on the demo site (2026-11-23):
// Affected services [{ id: ari }] with the name only in renderedFields, and Components [{ id, name }].
// Components is the only entity field (Assets values were not readable by the demo user). No live calls.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  bodies: [] as Record<string, unknown>[],
  pages: [] as { status: number; json: unknown }[],
}));

vi.mock('@forge/api', () => ({
  route: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((a, x, i) => a + x + (i < v.length ? String(v[i]) : ''), ''),
  default: {
    asApp: () => ({
      requestJira: async (_path: string, init: { body: string }) => {
        h.bodies.push(JSON.parse(init.body));
        const page = h.pages.shift() ?? { status: 200, json: { issues: [] } };
        return { ok: page.status >= 200 && page.status < 300, status: page.status, json: async () => page.json };
      },
    }),
  },
}));

import { MAX_CLUSTER_REQUESTS, openRequestsForClustering } from '../clusterSource';

const SERVICE = 'ari:cloud:graph::service/414c92ba-476b-40d4-b372-dc77303709e2/d93ef769-3160-46c8-a894-fb4f6dc8a48e';
const issue = (key: string, created: string, fields: Record<string, unknown> = {}, rendered: Record<string, unknown> = {}) => ({ key, fields: { created, ...fields }, renderedFields: rendered });
const settings = { affectedServicesField: 'customfield_10039', clusterEntityField: 'components' };

beforeEach(() => {
  h.bodies = [];
  h.pages = [];
});

describe('openRequestsForClustering', () => {
  it('asks for open requests in the window with only the identity fields, as one JQL search', async () => {
    await openRequestsForClustering('ITS', settings, 95);
    expect(h.bodies[0]).toEqual({
      jql: 'project = ITS AND statusCategory != Done AND created >= -95m ORDER BY created DESC',
      fields: ['created', 'customfield_10039', 'components'],
      expand: 'renderedFields',
      maxResults: 100,
    });
  });

  it('reads service IDs, component IDs and their display names; names never become identity', async () => {
    h.pages.push({
      status: 200,
      json: {
        issues: [
          issue('ITS-7', '2026-11-23T10:05:00.000+0000', { customfield_10039: [{ id: SERVICE }], components: [{ id: '10014', name: 'VPN Server' }] }, { customfield_10039: [{ id: SERVICE, name: 'Infrastructure Services' }] }),
          issue('ITS-8', '2026-11-23T10:06:00.000+0000', { customfield_10039: null, components: [] }),
        ],
      },
    });
    const out = await openRequestsForClustering('ITS', settings, 95);
    expect(out.requests).toEqual([
      { key: 'ITS-7', createdAt: '2026-11-23T10:05:00.000+0000', serviceIds: [SERVICE], entities: [{ kind: 'component', id: '10014' }] },
      { key: 'ITS-8', createdAt: '2026-11-23T10:06:00.000+0000', serviceIds: [], entities: [] },
    ]);
    expect(out.serviceNames.get(SERVICE.toLowerCase())).toBe('Infrastructure Services');
    expect(out.entityNames.get('10014')).toBe('VPN Server');
  });

  it('skips unusable component values and keeps components without a name', async () => {
    h.pages.push({ status: 200, json: { issues: [issue('ITS-9', 't', { components: [{ id: '10014' }, {}, 'junk', null, { id: 7 }] })] } });
    const out = await openRequestsForClustering('ITS', { clusterEntityField: 'components' }, 30);
    expect(out.requests[0].entities).toEqual([{ kind: 'component', id: '10014' }, { kind: 'component', id: '7' }]);
    expect(out.entityNames.size).toBe(0);
    expect(h.bodies[0].fields).toEqual(['created', 'components']);
  });

  it('skips service values without an ID and keeps a service whose name is not rendered', async () => {
    h.pages.push({ status: 200, json: { issues: [issue('ITS-3', 't', { customfield_10039: [{ name: 'no id' }, { id: SERVICE }, { id: 42 }] })] } });
    const out = await openRequestsForClustering('ITS', { affectedServicesField: 'customfield_10039' }, 30);
    expect(out.requests[0].serviceIds).toEqual([SERVICE, '42']);
    expect(out.serviceNames.size).toBe(0);
  });

  it('pages with nextPageToken up to MAX_CLUSTER_REQUESTS', async () => {
    const page = (n: number, token?: string) => ({ status: 200, json: { issues: Array.from({ length: n }, (_v, i) => issue(`ITS-${i}`, 't')), ...(token ? { nextPageToken: token } : {}) } });
    h.pages.push(page(100, 'p2'), page(100, 'p3'), page(100, 'p4'));
    const out = await openRequestsForClustering('ITS', settings, 30);
    expect(out.requests).toHaveLength(MAX_CLUSTER_REQUESTS);
    expect(h.bodies.map((b) => b.nextPageToken)).toEqual([undefined, 'p2']);
  });

  it('handles a response without an issues list', async () => {
    h.pages.push({ status: 200, json: {} });
    expect((await openRequestsForClustering('ITS', settings, 30)).requests).toEqual([]);
  });

  it('works with no identity fields configured, reading only the created time', async () => {
    h.pages.push({ status: 200, json: { issues: [issue('ITS-1', 't', { customfield_10039: [{ id: SERVICE }] })] } });
    const out = await openRequestsForClustering('ITS', {}, 30);
    expect(h.bodies[0].fields).toEqual(['created']);
    expect(out.requests[0]).toEqual({ key: 'ITS-1', createdAt: 't', serviceIds: [], entities: [] });
  });

  it('treats a missing created time as empty, so the domain ignores the request', async () => {
    h.pages.push({ status: 200, json: { issues: [{ key: 'ITS-2', fields: {} }] } });
    expect((await openRequestsForClustering('ITS', settings, 30)).requests[0].createdAt).toBe('');
  });

  it('rejects a malformed project key before calling Jira, and turns HTTP errors into short codes', async () => {
    await expect(openRequestsForClustering('its) OR 1=1', settings, 30)).rejects.toThrow('cluster-bad-project');
    expect(h.bodies).toEqual([]);
    h.pages.push({ status: 503, json: {} });
    await expect(openRequestsForClustering('ITS', settings, 30)).rejects.toThrow('cluster-search-503');
  });
});
