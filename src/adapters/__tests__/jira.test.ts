// Jira adapter tests against recorded demo-site responses (spec §19.7: no live calls in CI).
// The fixture is the real ITS-6265 scenario: a login ticket, the active login incident ITO-9647,
// the past SSL fix ITO-9642 (same requester), plus unrelated database, VPN and Dashloop tickets.
import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Loaded with fs rather than a JSON import: the fixture lives outside src (tsconfig rootDir).
// Typed loosely on purpose: it is raw recorded Jira JSON.
const fixture: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'jira-demo-site.json'), 'utf8'));

type Call = { path: string; body?: { jql?: string; maxResults?: number } };

const mock = vi.hoisted(() => ({
  calls: [] as { path: string; body?: { jql?: string; maxResults?: number } }[],
  handler: null as null | ((path: string, body?: { jql?: string }) => { status: number; json: unknown } | Promise<never>),
}));

vi.mock('@forge/api', () => ({
  // route is a tagged template in Forge; joining the parts is enough for these tests.
  route: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''), ''),
  default: {
    asApp: () => ({
      requestJira: async (path: string, init?: { body?: string }) => {
        const body = init?.body ? JSON.parse(init.body) : undefined;
        mock.calls.push({ path, body });
        const res = await mock.handler!(path, body);
        return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.json };
      },
    }),
  },
}));

import { getTicket, MAX_SECTION_CANDIDATES, searchIncidents, searchResolutions, SOURCE_PROJECTS } from '../jira';

const comments = fixture.comments as Record<string, unknown>;

/** Serves the recorded responses the way Jira would. */
function demoSite(overrides: { failComments?: string[]; failSearch?: boolean } = {}) {
  return (path: string, body?: { jql?: string }) => {
    if (path.startsWith('/rest/api/3/search/jql')) {
      if (overrides.failSearch) return { status: 500, json: {} };
      const jql = body?.jql ?? '';
      if (jql.includes('[System] Incident')) return { status: 200, json: fixture.incidentSearch };
      if (jql.includes('reporter =')) return { status: 200, json: fixture.requesterSearch };
      return { status: 200, json: fixture.resolutionSearch };
    }
    const comment = path.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment/);
    if (comment) {
      if (overrides.failComments?.includes(comment[1])) return { status: 503, json: {} };
      return { status: 200, json: comments[comment[1]] ?? { comments: [] } };
    }
    if (path.startsWith('/rest/api/3/issue/ITS-6265')) return { status: 200, json: fixture.ticket };
    return { status: 404, json: {} };
  };
}

const searches = (): Call[] => mock.calls.filter((c) => c.path.startsWith('/rest/api/3/search/jql'));

beforeEach(() => {
  mock.calls = [];
  mock.handler = demoSite();
});

describe('getTicket', () => {
  it('maps the issue to a Ticket', async () => {
    const t = await getTicket('ITS-6265');
    expect(t.key).toBe('ITS-6265');
    expect(t.projectKey).toBe('ITS');
    expect(t.summary).toBe('Cannot log in - getting error on login page');
    expect(t.description).toContain('generic error message');
    expect(t.requester?.displayName).toBe('Max Taylor');
    expect(t.requestTypeId).toBe('10');
    expect(t.priority).toBe('High');
    expect(t.labels).toEqual(['VIP']);
    expect(t.status).toBe('Waiting for support');
    expect(t.serviceIds).toHaveLength(1);
    expect(t.serviceIds[0]).toMatch(/^ari:cloud:graph::service\//);
  });

  it('falls back to the key prefix when the project is missing', async () => {
    mock.handler = () => ({ status: 200, json: { id: '1', key: 'ITS-1', self: 'https://x.atlassian.net/rest/api/3/issue/1', fields: {} } });
    const t = await getTicket('ITS-1');
    expect(t.projectKey).toBe('ITS');
    expect(t.serviceIds).toEqual([]);
    expect(t.labels).toEqual([]);
    expect(t.requester).toBeUndefined();
  });

  it('throws a short error code when Jira fails', async () => {
    mock.handler = () => ({ status: 404, json: {} });
    await expect(getTicket('ITS-404')).rejects.toThrow('jira-get-404');
  });
});

describe('searchIncidents (demo site ITS-6265)', () => {
  it('returns the active login incident and nothing unrelated', async () => {
    const incidents = await searchIncidents(await getTicket('ITS-6265'));
    expect(incidents.map((i) => i.source.id)).toContain('ITO-9647');
    const login = incidents.find((i) => i.source.id === 'ITO-9647')!;
    expect(login.status).toBe('active');
    expect(login.source.url).toBe('https://one-atlas-edlg.atlassian.net/browse/ITO-9647');
    expect(login.startedAt).toBeTruthy();
    // Database and VPN incidents and the unrelated Webstore incident must not appear.
    for (const unrelated of ['ITO-9648', 'ITO-9649', 'ITO-9645', 'ITO-9646', 'ITO-9630']) {
      expect(incidents.map((i) => i.source.id)).not.toContain(unrelated);
    }
  });

  it('builds the JQL for incident projects, excludes the ticket itself and limits the window', async () => {
    await searchIncidents(await getTicket('ITS-6265'));
    const jql = searches()[0].body!.jql!;
    expect(jql).toContain(`project in (${SOURCE_PROJECTS.join(', ')})`);
    expect(jql).toContain('issuetype = "[System] Incident"');
    expect(jql).toContain('key != "ITS-6265"');
    expect(jql).toMatch(/resolved >= -\d+d/);
  });

  it('escapes quotes in values interpolated into JQL', async () => {
    const t = await getTicket('ITS-6265');
    await searchIncidents({ ...t, key: 'ITS-1" OR project = SECRET OR key = "x' });
    expect(searches()[0].body!.jql).toContain('key != "ITS-1\\" OR project = SECRET OR key = \\"x"');
  });

  it('drops cancelled incidents and caps the section size', async () => {
    const base = fixture.incidentSearch.issues.find((i: { key: string }) => i.key === 'ITO-9647');
    const many = Array.from({ length: MAX_SECTION_CANDIDATES + 3 }, (_, n) => ({ ...base, key: `ITO-${100 + n}`, id: String(100 + n) }));
    const cancelled = { ...base, key: 'ITO-999', fields: { ...base.fields, status: { name: 'Cancelled', statusCategory: { key: 'done' } } } };
    mock.handler = (path) => (path.startsWith('/rest/api/3/search/jql') ? { status: 200, json: { issues: [cancelled, ...many] } } : demoSite()(path));
    const incidents = await searchIncidents(await getTicket('ITS-6265'));
    expect(incidents).toHaveLength(MAX_SECTION_CANDIDATES);
    expect(incidents.map((i) => i.source.id)).not.toContain('ITO-999');
  });

  it('attaches a 0..1 relevance to every incident', async () => {
    const incidents = await searchIncidents(await getTicket('ITS-6265'));
    for (const i of incidents) {
      expect(i.relevance).toBeGreaterThan(0);
      expect(i.relevance).toBeLessThanOrEqual(1);
    }
  });

  it('ranks an active incident above a resolved one with the same text (status term, spec §9.3)', async () => {
    const base = fixture.incidentSearch.issues.find((i: { key: string }) => i.key === 'ITO-9647');
    const resolved = { ...base, key: 'ITO-1', fields: { ...base.fields, status: { name: 'Completed', statusCategory: { key: 'done' } } } };
    const active = { ...base, key: 'ITO-2' };
    mock.handler = (path) => (path.startsWith('/rest/api/3/search/jql') ? { status: 200, json: { issues: [resolved, active] } } : demoSite()(path));
    const ids = (await searchIncidents(await getTicket('ITS-6265'), new Date('2026-11-21T00:00:00Z'))).map((i) => i.source.id);
    expect(ids).toEqual(['ITO-2', 'ITO-1']);
  });

  it('is deterministic for a fixed clock', async () => {
    const t = await getTicket('ITS-6265');
    const now = new Date('2026-11-21T00:00:00Z');
    expect(await searchIncidents(t, now)).toEqual(await searchIncidents(t, now));
  });

  it('keeps stored excerpts short', async () => {
    const incidents = await searchIncidents(await getTicket('ITS-6265'));
    for (const i of incidents) expect(i.summary.length).toBeLessThanOrEqual(301);
  });

  it('throws when the search fails, so the builder can mark the section as failed', async () => {
    const t = await getTicket('ITS-6265');
    mock.handler = demoSite({ failSearch: true });
    await expect(searchIncidents(t)).rejects.toThrow('jira-search-500');
  });
});

describe('searchResolutions (demo site ITS-6265)', () => {
  it('returns the SSL fix as same requester and similar symptoms, with the fix text', async () => {
    const resolutions = await searchResolutions(await getTicket('ITS-6265'));
    const ssl = resolutions.find((r) => r.source.id === 'ITO-9642');
    expect(ssl).toBeDefined();
    expect(ssl!.matchReason).toBe('both');
    expect(ssl!.resolutionText.startsWith('Root cause: SSL certificate on auth-lb-01 expired')).toBe(true);
    expect(ssl!.resolvedAt).toBeTruthy();
  });

  it('attaches the match strength as relevance', async () => {
    const ssl = (await searchResolutions(await getTicket('ITS-6265'))).find((r) => r.source.id === 'ITO-9642')!;
    expect(ssl.relevance).toBeGreaterThanOrEqual(0.2);
    expect(ssl.relevance).toBeLessThanOrEqual(1);
  });

  it('does not return unrelated Dashloop, database or VPN fixes', async () => {
    const ids = (await searchResolutions(await getTicket('ITS-6265'))).map((r) => r.source.id);
    for (const unrelated of ['ITS-6258', 'ITS-6259', 'ITS-6262', 'ITO-9645', 'ITO-9646']) expect(ids).not.toContain(unrelated);
  });

  it('searches the requester separately and excludes cancelled and unresolved tickets', async () => {
    await searchResolutions(await getTicket('ITS-6265'));
    const jqls = searches().map((c) => c.body!.jql!);
    expect(jqls).toHaveLength(2);
    for (const jql of jqls) {
      expect(jql).toContain('statusCategory = Done');
      expect(jql).toContain('status != Cancelled');
      expect(jql).toContain('key != "ITS-6265"');
    }
    expect(jqls.some((j) => j.includes(`reporter = "${fixture.ticket.fields.reporter.accountId}"`))).toBe(true);
  });

  it('skips the requester search when the ticket has no requester', async () => {
    const t = await getTicket('ITS-6265');
    await searchResolutions({ ...t, requester: undefined });
    expect(searches()).toHaveLength(1);
  });

  it('drops only the candidate whose comment fetch fails', async () => {
    const t = await getTicket('ITS-6265');
    mock.handler = demoSite({ failComments: ['ITO-9645'] });
    const ids = (await searchResolutions(t)).map((r) => r.source.id);
    expect(ids).toContain('ITO-9642');
  });

  it('returns nothing when the only matching ticket has no fix comment', async () => {
    const t = await getTicket('ITS-6265');
    mock.handler = demoSite({ failComments: ['ITO-9642'] });
    expect((await searchResolutions(t)).map((r) => r.source.id)).not.toContain('ITO-9642');
  });

  it('returns an empty list, not an error, when nothing matches', async () => {
    const t = await getTicket('ITS-6265');
    const resolutions = await searchResolutions({ ...t, summary: 'Printer jam on floor three', description: 'Paper tray stuck', requester: undefined, serviceIds: [] });
    expect(resolutions).toEqual([]);
  });
});
