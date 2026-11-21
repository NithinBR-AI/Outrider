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
  calls: [] as { as: 'app' | 'user'; path: string; body?: { jql?: string; maxResults?: number } }[],
  handler: null as null | ((path: string, body?: { jql?: string }) => { status: number; json: unknown } | Promise<never>),
}));

vi.mock('@forge/api', () => {
  // Records which identity made each call, so tests can prove the visibility check runs as the viewer.
  const requester = (as: 'app' | 'user') => ({
    requestJira: async (path: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      mock.calls.push({ as, path, body });
      const res = await mock.handler!(path, body);
      return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.json };
    },
  });
  return {
    // route is a tagged template in Forge; joining the parts is enough for these tests.
    route: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''), ''),
    default: { asApp: () => requester('app'), asUser: () => requester('user') },
  };
});

import { getTicket, MAX_SECTION_CANDIDATES, searchIncidents, searchResolutions, liveSourceTexts, SOURCE_PROJECTS, visibleIssueKeys } from '../jira';

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

describe('visibleIssueKeys (read-time authorization, spec §16)', () => {
  // Simulates Jira answering a viewer's JQL: only keys in `canSee` come back.
  const viewerCanSee = (canSee: string[]) => (_path: string, body?: { jql?: string }) => {
    const asked = (body?.jql ?? '').replace(/^key in \(|\)$/g, '').split(', ');
    return { status: 200, json: { issues: asked.filter((k) => canSee.includes(k)).map((key) => ({ key })) } };
  };

  it('runs as the viewer, never as the app', async () => {
    mock.handler = viewerCanSee(['ITS-6265']);
    await visibleIssueKeys(['ITS-6265', 'ITO-9647']);
    expect(mock.calls.length).toBeGreaterThan(0);
    expect(mock.calls.every((c) => c.as === 'user')).toBe(true);
  });

  it('returns only the keys the viewer can see (demo site: user B sees ITS, not ITO)', async () => {
    mock.handler = viewerCanSee(['ITS-6265']);
    expect([...(await visibleIssueKeys(['ITS-6265', 'ITO-9647', 'ITO-9642']))]).toEqual(['ITS-6265']);
  });

  it('checks all keys in one JQL search', async () => {
    mock.handler = viewerCanSee([]);
    await visibleIssueKeys(['ITS-6265', 'ITO-9647', 'ITO-9642']);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].path).toBe('/rest/api/3/search/jql');
    expect(mock.calls[0].body).toMatchObject({ jql: 'key in (ITS-6265, ITO-9647, ITO-9642)', maxResults: 3 });
  });

  it('never sends values that are not issue keys, so JQL cannot be injected', async () => {
    mock.handler = viewerCanSee(['ITS-1']);
    const visible = await visibleIssueKeys(['ITS-1', 'ITS-2) OR project = SECRET OR key in (X-1', 'lowercase-1', '"ITS-3"', '']);
    expect(mock.calls[0].body!.jql).toBe('key in (ITS-1)');
    expect([...visible]).toEqual(['ITS-1']);
  });

  it('removes duplicate keys', async () => {
    mock.handler = viewerCanSee(['ITS-1']);
    await visibleIssueKeys(['ITS-1', 'ITS-1', 'ITS-1']);
    expect(mock.calls[0].body!.jql).toBe('key in (ITS-1)');
  });

  it('makes no call for an empty list', async () => {
    expect([...(await visibleIssueKeys([]))]).toEqual([]);
    expect(mock.calls).toHaveLength(0);
  });

  it('splits large key lists into batches of 50', async () => {
    const keys = Array.from({ length: 120 }, (_, i) => `ITS-${i + 1}`);
    mock.handler = viewerCanSee(keys);
    const visible = await visibleIssueKeys(keys);
    expect(mock.calls.map((c) => c.body!.maxResults)).toEqual([50, 50, 20]);
    expect(visible.size).toBe(120);
  });

  it('throws a short code when the check fails, so callers can fail closed', async () => {
    mock.handler = () => ({ status: 503, json: {} });
    await expect(visibleIssueKeys(['ITS-1'])).rejects.toThrow('jira-visibility-503');
  });
});

describe('liveSourceTexts (verifier input, spec §13.2 step 3)', () => {
  const adf = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const issue = (key: string, summary: string, description: string, comments: string[]) => ({
    id: key,
    key,
    self: `https://one-atlas-edlg.atlassian.net/rest/api/3/issue/${key}`,
    fields: { summary, description: adf(description), updated: '2026-11-21T04:00:00.000+0000', comment: { comments: comments.map((c) => ({ body: adf(c) })) } },
  });

  it('runs as the viewer and asks for summary, description and comments in one search', async () => {
    mock.handler = () => ({ status: 200, json: { issues: [] } });
    await liveSourceTexts(['ITO-9642', 'ITS-6258']);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].as).toBe('user');
    expect(mock.calls[0].body).toMatchObject({ jql: 'key in (ITO-9642, ITS-6258)', fields: ['summary', 'description', 'comment', 'updated'], maxResults: 2 });
  });

  it('joins summary, description and every returned comment into the live text', async () => {
    mock.handler = () => ({ status: 200, json: { issues: [issue('ITO-9642', 'SSL failure', 'Users saw 503 errors.', ['Root cause: expired certificate.', 'Renewed via Let\'s Encrypt.'])] } });
    const live = await liveSourceTexts(['ITO-9642']);
    expect(live.get('jira-issue:ITO-9642')!.text).toBe("SSL failure\nUsers saw 503 errors.\nRoot cause: expired certificate.\nRenewed via Let's Encrypt.");
  });

  it('returns a current source reference for links', async () => {
    mock.handler = () => ({ status: 200, json: { issues: [issue('ITO-9642', 'SSL failure', '', [])] } });
    const ref = (await liveSourceTexts(['ITO-9642'])).get('jira-issue:ITO-9642')!.ref;
    expect(ref).toEqual({ kind: 'jira-issue', id: 'ITO-9642', url: 'https://one-atlas-edlg.atlassian.net/browse/ITO-9642', title: 'SSL failure', updatedAt: '2026-11-21T04:00:00.000+0000' });
  });

  it('leaves out issues Jira does not return to the viewer', async () => {
    mock.handler = () => ({ status: 200, json: { issues: [issue('ITS-6258', 'VPN', 'x', [])] } });
    const live = await liveSourceTexts(['ITO-9642', 'ITS-6258']);
    expect([...live.keys()]).toEqual(['jira-issue:ITS-6258']);
  });

  it('never sends values that are not issue keys', async () => {
    mock.handler = () => ({ status: 200, json: { issues: [] } });
    await liveSourceTexts(['ITS-1', 'ITS-2) OR project = ITO', '']);
    expect(mock.calls[0].body!.jql).toBe('key in (ITS-1)');
  });

  it('makes no call when nothing is cited, and throws a short code on failure', async () => {
    expect((await liveSourceTexts([])).size).toBe(0);
    expect(mock.calls).toHaveLength(0);
    mock.handler = () => ({ status: 500, json: {} });
    await expect(liveSourceTexts(['ITS-1'])).rejects.toThrow('jira-live-text-500');
  });

  it('tolerates issues without description or comments', async () => {
    mock.handler = () => ({ status: 200, json: { issues: [{ id: '1', key: 'ITS-1', self: 'https://x.atlassian.net/rest/api/3/issue/1', fields: { summary: 'Only a title' } }] } });
    expect((await liveSourceTexts(['ITS-1'])).get('jira-issue:ITS-1')!.text).toBe('Only a title');
  });
});