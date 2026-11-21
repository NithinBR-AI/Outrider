// Unit tests for the get-ticket-context tool logic. Jira, storage and the queue are mocked;
// the real filter (domain/authorize.ts) is used. Integration coverage: tests/integration/mcp-authorization.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildStatus, ContextBundle } from '../../domain/types';

const h = vi.hoisted(() => ({
  visibleIssueKeys: vi.fn(),
  getBundle: vi.fn(),
  getStatus: vi.fn(),
  enqueueTicketBuild: vi.fn(),
  getTicket: vi.fn(),
  searchIncidents: vi.fn(),
  searchResolutions: vi.fn(),
  getSettings: vi.fn(),
}));
// Explicit site settings (Phase 5.5), as on the demo site.
const SETTINGS = { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], affectedServicesField: 'customfield_10039', requestTypeField: 'customfield_10010' };
vi.mock('../../adapters/jira', () => ({ visibleIssueKeys: h.visibleIssueKeys, getTicket: h.getTicket, searchIncidents: h.searchIncidents, searchResolutions: h.searchResolutions }));
vi.mock('../../adapters/settings', () => ({ getSettings: h.getSettings }));
vi.mock('../../adapters/storage', () => ({ getBundle: h.getBundle, getStatus: h.getStatus }));
vi.mock('../../pipeline/enqueue', () => ({ enqueueTicketBuild: h.enqueueTicketBuild }));

import { CLAIMS_NOTE, findRelatedIncidents, findSimilarResolutions, getTicketContext, NOT_ACCESSIBLE_MESSAGE, PENDING_MESSAGE, toMcpBundle, UNSUPPORTED_CLAIM_NOTE } from '../tools';
import { MAX_TOOL_RESULTS } from '../../domain/query';
import { NOT_SET_UP_MESSAGE } from '../../domain/settings';
import { Incident, Resolution, Ticket } from '../../domain/types';
import { AUTH_JIRA_CHECK_FAILED } from '../../domain/authorize';

const ref = (id: string) => ({ kind: 'jira-issue' as const, id, url: `https://x/browse/${id}`, title: id, updatedAt: 'u' });
const bundle: ContextBundle = {
  ticketKey: 'ITS-1',
  builtAt: 't',
  buildId: 'b1',
  ticketFingerprint: 'fp',
  incidents: [{ source: ref('ITO-1'), status: 'active', summary: 'restricted', relevance: 0.5 }],
  resolutions: [{ source: ref('ITS-2'), resolvedAt: 't', resolutionText: 'fix', matchReason: 'same-symptom', relevance: 0.4 }],
  articles: [],
  services: [],
  partial: false,
  failures: [],
};
const status = (s: BuildStatus['status'], buildId = 'b-flight'): BuildStatus => ({ ticketKey: 'ITS-1', buildId, requestedAt: '2026-11-21T04:00:00.000Z', status: s, actor: { source: 'jira-event' } });
const sees = (...keys: string[]) => async (asked: string[]) => new Set(asked.filter((k) => keys.includes(k)));

beforeEach(() => {
  h.visibleIssueKeys.mockReset();
  h.getBundle.mockReset().mockResolvedValue(undefined);
  h.getStatus.mockReset().mockResolvedValue(undefined);
  h.enqueueTicketBuild.mockReset().mockResolvedValue({ buildId: 'b-new', requestedAt: '2026-11-21T04:05:00.000Z' });
  h.getSettings.mockReset().mockResolvedValue(SETTINGS);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('authorization gate', () => {
  it('ticket not visible: not-accessible, and nothing is read or queued', async () => {
    h.visibleIssueKeys.mockImplementation(sees());
    expect(await getTicketContext('ITS-1', 'caller')).toEqual({ status: 'not-accessible', ticketKey: 'ITS-1', message: NOT_ACCESSIBLE_MESSAGE });
    expect(h.getBundle).not.toHaveBeenCalled();
    expect(h.getStatus).not.toHaveBeenCalled();
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
  });

  it('ticket check fails: not-accessible (fails closed), nothing read or queued', async () => {
    h.visibleIssueKeys.mockRejectedValue(new Error('jira-visibility-503'));
    expect(await getTicketContext('ITS-1', 'caller')).toMatchObject({ status: 'not-accessible' });
    expect(h.getBundle).not.toHaveBeenCalled();
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
  });

  it('checks only the ticket in the first call', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
    await getTicketContext('ITS-1', 'caller');
    expect(h.visibleIssueKeys.mock.calls[0][0]).toEqual(['ITS-1']);
  });
});

describe('no bundle yet', () => {
  beforeEach(() => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
  });

  it.each(['queued', 'building'] as const)('build %s: returns pending for that build, queues nothing', async (s) => {
    h.getStatus.mockResolvedValue(status(s));
    expect(await getTicketContext('ITS-1', 'caller')).toEqual({ status: 'pending', ticketKey: 'ITS-1', buildId: 'b-flight', requestedAt: '2026-11-21T04:00:00.000Z', message: PENDING_MESSAGE });
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
  });

  it('no status: queues a build attributed to the caller and returns pending for it', async () => {
    expect(await getTicketContext('ITS-1', 'caller-1')).toEqual({ status: 'pending', ticketKey: 'ITS-1', buildId: 'b-new', requestedAt: '2026-11-21T04:05:00.000Z', message: PENDING_MESSAGE });
    expect(h.enqueueTicketBuild).toHaveBeenCalledWith('ITS-1', { accountId: 'caller-1', source: 'unknown' });
  });

  it.each(['failed', 'enqueue_failed', 'complete', 'superseded'] as const)('last build %s without a bundle: queues a fresh build', async (s) => {
    h.getStatus.mockResolvedValue(status(s));
    expect(await getTicketContext('ITS-1', 'caller')).toMatchObject({ status: 'pending', buildId: 'b-new' });
    expect(h.enqueueTicketBuild).toHaveBeenCalledTimes(1);
  });
});

describe('bundle exists', () => {
  beforeEach(() => {
    h.getBundle.mockResolvedValue(bundle);
  });

  it('returns it filtered for the caller', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1', 'ITS-2'));
    const r = (await getTicketContext('ITS-1', 'caller')) as ContextBundle;
    expect(r.incidents).toEqual([]);
    expect(r.resolutions.map((x) => x.source.id)).toEqual(['ITS-2']);
    expect(r.partial).toBe(false);
    expect(JSON.stringify(r)).not.toContain('restricted');
  });

  it('checks the sources in a second call, after the ticket', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1', 'ITO-1', 'ITS-2'));
    await getTicketContext('ITS-1', 'caller');
    expect(h.visibleIssueKeys.mock.calls[1][0]).toEqual(['ITO-1', 'ITS-2']);
  });

  it('leaves out internal bookkeeping fields and keeps what an agent needs', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1', 'ITO-1', 'ITS-2'));
    const r = (await getTicketContext('ITS-1', 'caller')) as Record<string, unknown>;
    expect(r).not.toHaveProperty('buildId');
    expect(r).not.toHaveProperty('ticketFingerprint');
    expect(r).toMatchObject({ ticketKey: 'ITS-1', builtAt: 't', partial: false, failures: [] });
    expect(Object.keys(r).sort()).toEqual(['articles', 'builtAt', 'failures', 'incidents', 'partial', 'resolutions', 'services', 'ticketKey']);
  });

  it('keeps the build ID on the pending response, as the spec defines it', async () => {
    h.getBundle.mockResolvedValue(undefined);
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
    expect(await getTicketContext('ITS-1', 'caller')).toHaveProperty('buildId', 'b-new');
  });

  it('annotates the verified summary for agents and renames rejected to unsupportedClaims', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1', 'ITO-1', 'ITS-2'));
    const viewer = { ...bundle, summary: { claims: [{ text: 'c', source: ref('ITO-1'), span: 's', grounded: true }], rejected: [{ text: 'made up', reason: 'no-matching-span' as const }], origin: 'llm' as const } };
    const out = toMcpBundle(viewer);
    expect(out.summary).toEqual({
      claimsNote: CLAIMS_NOTE,
      claims: viewer.summary.claims,
      unsupportedClaims: [{ text: 'made up', reason: 'no-matching-span', note: UNSUPPORTED_CLAIM_NOTE }],
      origin: 'llm',
    });
    expect(out).not.toHaveProperty('buildId');
  });

  it('leaves the summary out when the viewer has none', () => {
    const { summary: _none, ...withoutSummary } = bundle;
    expect(toMcpBundle(withoutSummary)).not.toHaveProperty('summary');
  });

  it('never returns the stored object itself', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1', 'ITO-1', 'ITS-2'));
    expect(await getTicketContext('ITS-1', 'caller')).not.toBe(bundle);
  });

  it('source check fails: drops every source and marks the response partial', async () => {
    h.visibleIssueKeys.mockImplementationOnce(sees('ITS-1')).mockRejectedValueOnce(new Error('jira-visibility-503'));
    const r = (await getTicketContext('ITS-1', 'caller')) as ContextBundle;
    expect(r.incidents).toEqual([]);
    expect(r.resolutions).toEqual([]);
    expect(r.partial).toBe(true);
    expect(r.failures).toEqual([AUTH_JIRA_CHECK_FAILED]);
  });

  it('does not queue a build when a bundle exists', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
    await getTicketContext('ITS-1', 'caller');
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
  });
});

// ---- find-related-incidents and find-similar-resolutions (spec §15.2, §15.3) ----

describe('find tools', () => {
  const its1: Ticket = { key: 'ITS-1', projectKey: 'ITS', summary: 'Cannot log in', description: 'Generic error', labels: [], serviceIds: [], status: 'Open', updatedAt: 'u' };
  const inc = (id: string): Incident => ({ source: ref(id), status: 'active', summary: `${id} text`, relevance: 0.5 });
  const res = (id: string): Resolution => ({ source: ref(id), resolvedAt: 't', resolutionText: `${id} fix`, matchReason: 'same-symptom', relevance: 0.4 });

  beforeEach(() => {
    h.getTicket.mockReset().mockResolvedValue(its1);
    h.searchIncidents.mockReset().mockResolvedValue([inc('ITO-1'), inc('ITS-5')]);
    h.searchResolutions.mockReset().mockResolvedValue([res('ITO-2'), res('ITS-6')]);
  });

  it('with a ticket the caller cannot see: not accessible, and no ticket read or search happens', async () => {
    h.visibleIssueKeys.mockImplementation(sees());
    expect(await findRelatedIncidents({ ticketKey: 'ITS-1' })).toEqual({ status: 'not-accessible', ticketKey: 'ITS-1', message: NOT_ACCESSIBLE_MESSAGE });
    expect(await findSimilarResolutions({ ticketKey: 'ITS-1' })).toEqual({ status: 'not-accessible', ticketKey: 'ITS-1', message: NOT_ACCESSIBLE_MESSAGE });
    expect(h.getTicket).not.toHaveBeenCalled();
    expect(h.searchIncidents).not.toHaveBeenCalled();
    expect(h.searchResolutions).not.toHaveBeenCalled();
  });

  it('treats a failed ticket check, or a ticket that vanished after the check, as not accessible', async () => {
    h.visibleIssueKeys.mockRejectedValueOnce(new Error('jira-visibility-503'));
    expect(await findRelatedIncidents({ ticketKey: 'ITS-1' })).toMatchObject({ status: 'not-accessible' });
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
    h.getTicket.mockRejectedValueOnce(new Error('jira-get-404'));
    expect(await findRelatedIncidents({ ticketKey: 'ITS-1' })).toMatchObject({ status: 'not-accessible' });
  });

  it('searches live from the current ticket and keeps only results the caller can see', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1', 'ITS-5', 'ITS-6'));
    expect(await findRelatedIncidents({ ticketKey: 'ITS-1' })).toEqual({ incidents: [inc('ITS-5')], partial: false, failures: [] });
    expect(await findSimilarResolutions({ ticketKey: 'ITS-1' })).toEqual({ resolutions: [res('ITS-6')], partial: false, failures: [] });
    expect(h.searchIncidents).toHaveBeenCalledWith(its1, SETTINGS);
    expect(h.getTicket).toHaveBeenCalledWith('ITS-1', SETTINGS);
    expect(h.getBundle).not.toHaveBeenCalled(); // never the stored bundle
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
  });

  it('the ticket wins; free text is appended to its description as a hint', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
    await findRelatedIncidents({ ticketKey: 'ITS-1', text: 'after the SSO change' });
    expect(h.searchIncidents).toHaveBeenCalledWith({ ...its1, description: 'Generic error\nafter the SSO change' }, SETTINGS);
  });

  it('free text alone searches symptoms only, with no ticket check and no ticket read', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-5'));
    expect(await findRelatedIncidents({ text: 'VPN drops' })).toEqual({ incidents: [inc('ITS-5')], partial: false, failures: [] });
    expect(h.getTicket).not.toHaveBeenCalled();
    expect(h.searchIncidents).toHaveBeenCalledWith(expect.objectContaining({ key: '', summary: 'VPN drops', serviceIds: [] }), SETTINGS);
    expect(h.visibleIssueKeys).toHaveBeenCalledTimes(1);
    expect(h.visibleIssueKeys).toHaveBeenCalledWith(['ITO-1', 'ITS-5']);
  });

  it('caps results after filtering, so hidden results never use up a slot', async () => {
    const many = Array.from({ length: MAX_TOOL_RESULTS + 3 }, (_, n) => inc(`ITS-${100 + n}`));
    h.searchIncidents.mockResolvedValue([inc('ITO-1'), inc('ITO-2'), ...many]);
    h.visibleIssueKeys.mockImplementation(async (asked: string[]) => new Set(asked.filter((k) => k.startsWith('ITS-'))));
    const r = (await findRelatedIncidents({ text: 'x' })) as { incidents: Incident[] };
    expect(r.incidents.map((i) => i.source.id)).toEqual(many.slice(0, MAX_TOOL_RESULTS).map((i) => i.source.id));
  });

  it('empty results are valid, with no visibility call needed', async () => {
    h.searchResolutions.mockResolvedValue([]);
    h.visibleIssueKeys.mockImplementation(sees());
    expect(await findSimilarResolutions({ text: 'printer jam' })).toEqual({ resolutions: [], partial: false, failures: [] });
    expect(h.visibleIssueKeys).not.toHaveBeenCalled();
  });

  it('a failed result check returns nothing, marked partial, never unfiltered results', async () => {
    h.visibleIssueKeys.mockRejectedValue(new Error('jira-visibility-503'));
    expect(await findRelatedIncidents({ text: 'VPN' })).toEqual({ incidents: [], partial: true, failures: [AUTH_JIRA_CHECK_FAILED] });
    expect(await findSimilarResolutions({ text: 'VPN' })).toEqual({ resolutions: [], partial: true, failures: [AUTH_JIRA_CHECK_FAILED] });
  });

  it('a failed search returns nothing, marked partial with the source that failed', async () => {
    h.searchIncidents.mockRejectedValue(new Error('jira-search-500'));
    h.searchResolutions.mockRejectedValue(new Error('jira-search-500'));
    expect(await findRelatedIncidents({ text: 'VPN' })).toEqual({ incidents: [], partial: true, failures: ['jira-incidents'] });
    expect(await findSimilarResolutions({ text: 'VPN' })).toEqual({ resolutions: [], partial: true, failures: ['jira-resolutions'] });
  });
});

describe('site not set up (spec Phase 5.5)', () => {
  beforeEach(() => {
    h.getSettings.mockResolvedValue(undefined);
  });

  it('get-ticket-context: the same message as the panel, after the ticket gate, and no build is queued', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
    expect(await getTicketContext('ITS-1', 'caller')).toEqual({ status: 'not-set-up', message: NOT_SET_UP_MESSAGE });
    expect(h.getBundle).not.toHaveBeenCalled();
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
  });

  it('get-ticket-context: a caller who cannot see the ticket still gets not-accessible, not not-set-up', async () => {
    h.visibleIssueKeys.mockImplementation(sees());
    expect(await getTicketContext('ITS-1', 'caller')).toMatchObject({ status: 'not-accessible' });
  });

  it('get-ticket-context: a ticket outside the bundle projects is not set up even with settings', async () => {
    h.getSettings.mockResolvedValue({ bundleProjects: ['SUP'], sourceProjects: ['SUP'] });
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
    expect(await getTicketContext('ITS-1', 'caller')).toEqual({ status: 'not-set-up', message: NOT_SET_UP_MESSAGE });
  });

  it('find tools: not set up for text queries, and for named tickets after the gate, with no search', async () => {
    h.visibleIssueKeys.mockImplementation(sees('ITS-1'));
    expect(await findRelatedIncidents({ text: 'VPN' })).toEqual({ status: 'not-set-up', message: NOT_SET_UP_MESSAGE });
    expect(await findSimilarResolutions({ ticketKey: 'ITS-1' })).toEqual({ status: 'not-set-up', message: NOT_SET_UP_MESSAGE });
    h.visibleIssueKeys.mockImplementation(sees());
    expect(await findSimilarResolutions({ ticketKey: 'ITS-1' })).toMatchObject({ status: 'not-accessible' });
    expect(h.getTicket).not.toHaveBeenCalled();
    expect(h.searchIncidents).not.toHaveBeenCalled();
    expect(h.searchResolutions).not.toHaveBeenCalled();
  });

  it('find tools: work for a named ticket outside the bundle projects, as they search live', async () => {
    h.getSettings.mockResolvedValue({ bundleProjects: ['SUP'], sourceProjects: ['SUP', 'INC'] });
    h.visibleIssueKeys.mockImplementation(sees('INC-3', 'ITS-5'));
    h.getTicket.mockResolvedValue({ key: 'INC-3', projectKey: 'INC', summary: 's', description: '', labels: [], serviceIds: [], status: 'Open', updatedAt: 'u' });
    h.searchIncidents.mockResolvedValue([{ source: ref('ITS-5'), status: 'active', summary: 'x', relevance: 0.5 }]);
    expect(await findRelatedIncidents({ ticketKey: 'INC-3' })).toMatchObject({ incidents: [expect.objectContaining({ summary: 'x' })] });
  });
});
