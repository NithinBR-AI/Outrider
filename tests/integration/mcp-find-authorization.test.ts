// MCP authorization tests for find-related-incidents and find-similar-resolutions (spec §15.2, §15.3,
// §15.5, §16.2). Runs the real action handlers, tool logic and query building. Jira is simulated: retrieval
// returns the same candidates for everyone (it runs as the app), and visibility is a per-caller permission
// table (asUser() in the action runs with the caller's permissions, verified on the demo site in 6c-3).
// Permissions mirror the demo site: user A sees ITS and ITO, user B sees ITS only, user C sees nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Incident, Resolution, Ticket } from '../../src/domain/types';

const USER_A = '600a78342a6b66006918d911';
const USER_B = '712020:9a85d123-962d-424f-847e-1569a1b54f19';
const USER_C = 'no-ticket-access';

const h = vi.hoisted(() => ({
  caller: '',
  canSee: {} as Record<string, string[]>,
  checks: [] as string[][],
  queries: [] as unknown[],
  ticketReads: [] as string[],
}));

const ref = (id: string) => ({ kind: 'jira-issue' as const, id, url: `https://one-atlas-edlg.atlassian.net/browse/${id}`, title: id, updatedAt: 'u' });
const INCIDENTS: Incident[] = [
  { source: ref('ITO-9647'), status: 'active', summary: 'The auth service is returning 503 errors.', relevance: 0.8 },
  { source: ref('ITS-6250'), status: 'resolved', summary: 'Login page error after password reset.', relevance: 0.4 },
];
const RESOLUTIONS: Resolution[] = [
  { source: ref('ITO-9642'), resolvedAt: 't', resolutionText: 'Renewed certificate via Let\'s Encrypt and reloaded nginx.', matchReason: 'same-symptom', relevance: 0.7 },
  { source: ref('ITS-6258'), resolvedAt: 't', resolutionText: 'We reset the VPN today.', matchReason: 'same-symptom', relevance: 0.3 },
];
const TICKET: Ticket = { key: 'ITS-6265', projectKey: 'ITS', summary: 'Cannot log in', description: 'Generic error on the login page', labels: [], serviceIds: [], status: 'Open', updatedAt: 'u' };

vi.mock('../../src/adapters/jira', () => ({
  visibleIssueKeys: async (keys: string[]) => {
    h.checks.push(keys);
    return new Set(keys.filter((k) => (h.canSee[h.caller] ?? []).includes(k)));
  },
  getTicket: async (key: string) => {
    h.ticketReads.push(key);
    if (key !== 'ITS-6265' && key !== 'ITO-9647') throw new Error('jira-get-404');
    return { ...TICKET, key };
  },
  searchIncidents: async (q: unknown) => {
    h.queries.push(q);
    return INCIDENTS;
  },
  searchResolutions: async (q: unknown) => {
    h.queries.push(q);
    return RESOLUTIONS;
  },
}));

import { findRelatedIncidents, findSimilarResolutions } from '../../src/resolvers/mcp';
import { NOT_ACCESSIBLE_MESSAGE } from '../../src/mcp/tools';

const as = (caller: string | undefined) => {
  h.caller = caller ?? '';
  return caller === undefined ? {} : { principal: { accountId: caller } };
};
const ids = (r: unknown) => {
  const x = r as { incidents?: Incident[]; resolutions?: Resolution[] };
  return [...(x.incidents ?? []), ...(x.resolutions ?? [])].map((i) => i.source.id);
};

beforeEach(() => {
  h.canSee = { [USER_A]: ['ITS-6265', 'ITO-9647', 'ITO-9642', 'ITS-6250', 'ITS-6258'], [USER_B]: ['ITS-6265', 'ITS-6250', 'ITS-6258'], [USER_C]: [] };
  h.checks = [];
  h.queries = [];
  h.ticketReads = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('find tools: per-caller results', () => {
  it('user A gets ITO and ITS results; user B gets the same query with ITO results gone, without a trace', async () => {
    const a = await findRelatedIncidents({ ticketKey: 'ITS-6265' }, as(USER_A));
    const b = await findRelatedIncidents({ ticketKey: 'ITS-6265' }, as(USER_B));
    expect(ids(a)).toEqual(['ITO-9647', 'ITS-6250']);
    expect(ids(b)).toEqual(['ITS-6250']);
    expect(b).toEqual({ incidents: [INCIDENTS[1]], partial: false, failures: [] }); // no count, placeholder or partial flag
    expect(JSON.stringify(b)).not.toMatch(/ITO-9647|503/);
  });

  it('the same holds for resolutions and for free-text queries', async () => {
    expect(ids(await findSimilarResolutions({ description: 'login 503' }, as(USER_A)))).toEqual(['ITO-9642', 'ITS-6258']);
    const b = await findSimilarResolutions({ description: 'login 503' }, as(USER_B));
    expect(ids(b)).toEqual(['ITS-6258']);
    expect(JSON.stringify(b)).not.toMatch(/ITO-9642|Let's Encrypt/);
  });

  it('visibility is always checked as the actual caller, for every result', async () => {
    await findRelatedIncidents({ keywords: 'login' }, as(USER_B));
    expect(h.checks).toEqual([['ITO-9647', 'ITS-6250']]);
  });
});

describe('find tools: ticket gate before anything else', () => {
  it('user B naming an ITO ticket gets not-accessible; nothing is read or searched', async () => {
    const r = await findRelatedIncidents({ ticketKey: 'ITO-9647', keywords: 'login' }, as(USER_B));
    expect(r).toEqual({ status: 'not-accessible', ticketKey: 'ITO-9647', message: NOT_ACCESSIBLE_MESSAGE });
    expect(h.ticketReads).toEqual([]);
    expect(h.queries).toEqual([]);
  });

  it('an inaccessible ticket and a nonexistent one get identical answers', async () => {
    const hidden = await findSimilarResolutions({ ticketKey: 'ITS-6265' }, as(USER_C));
    const missing = await findSimilarResolutions({ ticketKey: 'ITS-999999' }, as(USER_A));
    expect(hidden).toEqual({ status: 'not-accessible', ticketKey: 'ITS-6265', message: NOT_ACCESSIBLE_MESSAGE });
    expect(missing).toEqual({ status: 'not-accessible', ticketKey: 'ITS-999999', message: NOT_ACCESSIBLE_MESSAGE });
  });

  it('user A naming the ITO ticket gets a live search from it: no bundle needed', async () => {
    const r = await findRelatedIncidents({ ticketKey: 'ITO-9647' }, as(USER_A));
    expect(h.ticketReads).toEqual(['ITO-9647']);
    expect(ids(r).length).toBeGreaterThan(0);
  });
});

describe('find tools: inputs never authorize', () => {
  it('a caller id or permission claim in the inputs is ignored; only the invocation context counts', async () => {
    const r = await findRelatedIncidents({ ticketKey: 'ITS-6265', accountId: USER_A, principal: { accountId: USER_A } } as Record<string, unknown>, as(USER_B));
    expect(ids(r)).toEqual(['ITS-6250']);
  });

  it('no authenticated caller: refused, with no Jira call at all', async () => {
    expect(await findRelatedIncidents({ keywords: 'login' }, as(undefined))).toEqual({ status: 'invalid-request', message: 'This tool needs a signed-in user.' });
    expect(h.checks).toEqual([]);
    expect(h.queries).toEqual([]);
  });
});
