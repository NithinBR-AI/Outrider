// Ticket builder tests (spec §8.3, §19.2): failure isolation, duplicate delivery, stale results.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Article, BuildStatus, ContextBundle, Incident, Resolution, Ticket } from '../../domain/types';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  getTicket: vi.fn(),
  searchIncidents: vi.fn(),
  searchResolutions: vi.fn(),
  enqueueTicketBuild: vi.fn(),
  requeueTicketJob: vi.fn(),
  generateClaims: vi.fn(),
  searchArticles: vi.fn(),
  embedTicketAndCandidates: vi.fn(),
}));

// In-memory KVS: FAIL_IF_EXISTS rejects when the key exists; expired keys are not removed.
vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => h.store.get(key),
    set: async (key: string, value: unknown, options?: { keyPolicy?: string }) => {
      if (options?.keyPolicy === 'FAIL_IF_EXISTS' && h.store.has(key)) throw new Error('conflict');
      h.store.set(key, value);
    },
    delete: async (key: string) => void h.store.delete(key),
  },
}));
vi.mock('../../adapters/jira', () => ({
  getTicket: h.getTicket,
  searchIncidents: h.searchIncidents,
  searchResolutions: h.searchResolutions,
}));
vi.mock('../enqueue', () => ({ enqueueTicketBuild: h.enqueueTicketBuild, requeueTicketJob: h.requeueTicketJob }));
// No network: the model call is mocked; the adapter has its own tests (adapters/__tests__/mantle.test.ts).
vi.mock('../../adapters/mantle', () => ({ generateClaims: h.generateClaims }));
vi.mock('../../adapters/confluence', () => ({ searchArticles: h.searchArticles }));
// Embeddings (step 12): unavailable by default, so the keyword ranking is used; the embeddings block below covers them.
vi.mock('../../adapters/jina', () => ({ embedTicketAndCandidates: h.embedTicketAndCandidates }));

import { buildTicketBundle } from '../buildTicket';
import { ticketFingerprint } from '../../domain/extract';
import { MAX_BUNDLE_CANDIDATES } from '../../domain/score';

const ticket: Ticket = { key: 'ITS-1', projectKey: 'ITS', summary: 'Cannot log in', description: '', labels: [], serviceIds: [], status: 'Open', updatedAt: 'u' };
const ref = (id: string) => ({ kind: 'jira-issue' as const, id, url: `https://x/browse/${id}`, title: id, updatedAt: 'u' });
const incident = (id: string): Incident => ({ source: ref(id), status: 'active', summary: 's', relevance: 0.5, startedAt: 't' });
const resolution = (id: string): Resolution => ({ source: ref(id), resolvedAt: 't', resolutionText: 'Root cause: x', matchReason: 'same-symptom', relevance: 0.5 });
const job = (buildId = 'build-a') => ({ kind: 'jira-ticket' as const, ticketKey: 'ITS-1', buildId, requestedAt: 'r', actor: { source: 'jira-event' as const } });
const setStatus = (s: Partial<BuildStatus>) => h.store.set('status:ITS-1', { ticketKey: 'ITS-1', buildId: 'build-a', requestedAt: 'r', status: 'queued', actor: { source: 'jira-event' }, ...s });
const status = () => h.store.get('status:ITS-1') as BuildStatus;
const bundle = () => h.store.get('bundle:ITS-1') as ContextBundle | undefined;

beforeEach(() => {
  h.store.clear();
  h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], affectedServicesField: 'customfield_10039', requestTypeField: 'customfield_10010', savedAt: 't' }); // explicit site settings (Phase 5.5)
  h.getTicket.mockReset().mockResolvedValue(ticket);
  h.searchIncidents.mockReset().mockResolvedValue([incident('ITO-1')]);
  h.searchResolutions.mockReset().mockResolvedValue([resolution('ITO-2')]);
  h.enqueueTicketBuild.mockReset().mockResolvedValue({ buildId: 'build-next', requestedAt: 'r2' });
  h.requeueTicketJob.mockReset().mockResolvedValue(undefined);
  h.searchArticles.mockReset().mockResolvedValue([]);
  h.embedTicketAndCandidates.mockReset().mockRejectedValue(new Error('embedding-no-key'));
  h.generateClaims.mockReset().mockResolvedValue({
    claims: [{ claimId: 'llm-1-abc', text: 'The auth service is returning 503 errors.', citedSourceRef: ref('ITO-1') }],
    model: 'qwen.qwen3-235b-a22b-2507',
    usage: { prompt_tokens: 700, completion_tokens: 120 },
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('buildTicketBundle', () => {
  it('stores a complete bundle and marks the build complete', async () => {
    setStatus({});
    await buildTicketBundle(job());
    expect(status().status).toBe('complete');
    const b = bundle()!;
    expect(b.buildId).toBe('build-a');
    expect(b.incidents.map((i) => i.source.id)).toEqual(['ITO-1']);
    expect(b.resolutions.map((r) => r.source.id)).toEqual(['ITO-2']);
    expect(b.partial).toBe(false);
    expect(b.failures).toEqual([]);
    expect(b.articles).toEqual([]);
    expect(b.services).toEqual([]);
  });

  it('keeps successful sections when one source fails (partial result)', async () => {
    setStatus({});
    h.searchResolutions.mockRejectedValue(new Error('boom: internal detail'));
    await buildTicketBundle(job());
    const b = bundle()!;
    expect(b.partial).toBe(true);
    expect(b.failures).toEqual(['jira-resolutions']);
    expect(b.incidents.map((i) => i.source.id)).toEqual(['ITO-1']);
    expect(b.resolutions).toEqual([]);
    // Exception details never reach the stored, user-visible failures.
    expect(JSON.stringify(b)).not.toContain('internal detail');
    expect(status().status).toBe('complete');
  });

  it('records both failures when both sources fail', async () => {
    setStatus({});
    h.searchIncidents.mockRejectedValue(new Error('a'));
    h.searchResolutions.mockRejectedValue(new Error('b'));
    await buildTicketBundle(job());
    expect(bundle()!.failures.sort()).toEqual(['jira-incidents', 'jira-resolutions']);
  });

  it('shows an incident that is also a past resolution only once, as the resolution', async () => {
    setStatus({});
    h.searchIncidents.mockResolvedValue([incident('ITO-1'), incident('ITO-2')]);
    await buildTicketBundle(job());
    expect(bundle()!.incidents.map((i) => i.source.id)).toEqual(['ITO-1']);
    expect(bundle()!.resolutions.map((r) => r.source.id)).toEqual(['ITO-2']);
  });

  it('marks the build failed, with a generic code, when the ticket cannot be fetched', async () => {
    setStatus({});
    h.getTicket.mockRejectedValue(new Error('jira-get-500'));
    await buildTicketBundle(job());
    expect(status().status).toBe('failed');
    expect(status().error).toBe('build-failed');
    expect(bundle()).toBeUndefined();
  });

  it('is a no-op on duplicate delivery after completion', async () => {
    setStatus({ status: 'complete' });
    await buildTicketBundle(job());
    expect(h.getTicket).not.toHaveBeenCalled();
    expect(bundle()).toBeUndefined();
  });

  it('can re-run the same build if delivered again while still building', async () => {
    setStatus({ status: 'building' });
    await buildTicketBundle(job());
    expect(status().status).toBe('complete');
    expect(bundle()).toBeDefined();
  });

  it('skips a job whose build no longer owns the status', async () => {
    setStatus({ buildId: 'build-newer' });
    await buildTicketBundle(job('build-a'));
    expect(h.getTicket).not.toHaveBeenCalled();
    expect(status().buildId).toBe('build-newer');
  });

  it('discards its result if a newer build takes over while it runs', async () => {
    setStatus({});
    h.searchResolutions.mockImplementation(async () => {
      setStatus({ buildId: 'build-newer', status: 'queued' });
      return [];
    });
    await buildTicketBundle(job('build-a'));
    expect(bundle()).toBeUndefined();
    expect(status().buildId).toBe('build-newer');
    expect(status().status).toBe('queued');
  });

  it('builds when no status exists yet', async () => {
    await buildTicketBundle(job());
    expect(bundle()).toBeDefined();
  });

  it('is a no-op on duplicate delivery after the build was superseded', async () => {
    setStatus({ status: 'superseded' });
    await buildTicketBundle(job());
    expect(h.getTicket).not.toHaveBeenCalled();
  });

  it('passes one shared clock to both sources so ranking is consistent', async () => {
    setStatus({});
    await buildTicketBundle(job());
    const nowIncidents = h.searchIncidents.mock.calls[0][2] as Date;
    const nowResolutions = h.searchResolutions.mock.calls[0][2] as Date;
    expect(nowIncidents).toBeInstanceOf(Date);
    expect(nowResolutions).toBe(nowIncidents);
    expect(bundle()!.builtAt).toBe(nowIncidents.toISOString());
  });

  it('enforces the stored-candidate limit across sections', async () => {
    setStatus({});
    h.searchIncidents.mockResolvedValue(Array.from({ length: 15 }, (_, i) => incident(`ITO-1${i}`)));
    h.searchResolutions.mockResolvedValue(Array.from({ length: 15 }, (_, i) => resolution(`ITO-2${i}`)));
    await buildTicketBundle(job());
    const b = bundle()!;
    expect(b.incidents.length + b.resolutions.length).toBe(MAX_BUNDLE_CANDIDATES);
    expect(b.incidents.length).toBeGreaterThan(0);
    expect(b.resolutions.length).toBeGreaterThan(0);
  });
});

describe('per-ticket lock and write guards (spec §8.5, §8.6)', () => {
  const lockRecord = (expiresInSeconds: number, ownerToken = 'other-token') => ({
    buildId: 'build-other',
    ownerToken,
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  });

  it('releases the lock after a successful build', async () => {
    setStatus({});
    await buildTicketBundle(job());
    expect(h.store.has('lock:ITS-1')).toBe(false);
  });

  it('releases the lock after a failed build', async () => {
    setStatus({});
    h.getTicket.mockRejectedValue(new Error('jira-get-500'));
    await buildTicketBundle(job());
    expect(status().status).toBe('failed');
    expect(h.store.has('lock:ITS-1')).toBe(false);
  });

  it('re-queues the same job when another build holds the lock, without doing any work', async () => {
    setStatus({});
    h.store.set('lock:ITS-1', lockRecord(300));
    await buildTicketBundle(job());
    expect(h.requeueTicketJob).toHaveBeenCalledWith(job());
    expect(h.getTicket).not.toHaveBeenCalled();
    expect(status().status).toBe('queued');
    // The other build's lock is left alone.
    expect((h.store.get('lock:ITS-1') as { ownerToken: string }).ownerToken).toBe('other-token');
  });

  it('takes over an expired lock left by a crashed build and completes', async () => {
    setStatus({});
    h.store.set('lock:ITS-1', lockRecord(-10, 'crashed-token'));
    await buildTicketBundle(job());
    expect(h.requeueTicketJob).not.toHaveBeenCalled();
    expect(bundle()).toBeDefined();
    expect(status().status).toBe('complete');
  });

  it('marks the build building only after it holds the lock', async () => {
    setStatus({});
    h.getTicket.mockImplementation(async () => {
      expect(status().status).toBe('building');
      expect(h.store.has('lock:ITS-1')).toBe(true);
      return ticket;
    });
    await buildTicketBundle(job());
  });

  it('discards the result if the lock was taken over before writing', async () => {
    setStatus({});
    h.searchResolutions.mockImplementation(async () => {
      // Another build takes over the lock mid-build (for example after this lease expired).
      h.store.set('lock:ITS-1', lockRecord(300, 'taker-token'));
      return [];
    });
    await buildTicketBundle(job());
    expect(bundle()).toBeUndefined();
    // The new owner's lock is not released by the loser.
    expect((h.store.get('lock:ITS-1') as { ownerToken: string }).ownerToken).toBe('taker-token');
  });

  it('does not touch the lock when skipping a job owned by a newer build', async () => {
    setStatus({ buildId: 'build-newer' });
    h.store.set('lock:ITS-1', lockRecord(300));
    await buildTicketBundle(job('build-a'));
    expect(h.requeueTicketJob).not.toHaveBeenCalled();
    expect(h.store.has('lock:ITS-1')).toBe(true);
  });
});

describe('live summary generation (spec §12.6, §13.6)', () => {
  const generated = [{ claimId: 'llm-1-abc', text: 'The auth service is returning 503 errors.', citedSourceRef: ref('ITO-1') }];

  it('stores the generated claims, unverified, with origin llm and the prompt hash', async () => {
    setStatus({});
    await buildTicketBundle(job());
    expect(h.generateClaims).toHaveBeenCalledTimes(1);
    const prompt = h.generateClaims.mock.calls[0][0];
    expect(Object.values(prompt.labels).map((r: any) => r.id)).toEqual(['ITO-1', 'ITO-2']);
    expect(bundle()!.summary).toEqual({ origin: 'llm', promptHash: expect.stringMatching(/^[0-9a-f]{32}$/), generatedClaims: generated });
    expect(status().status).toBe('complete');
  });

  it('applies to every ticket, the demo ticket included: nothing is canned', async () => {
    h.store.set('status:ITS-6265', { ticketKey: 'ITS-6265', buildId: 'build-a', requestedAt: 'r', status: 'queued', actor: { source: 'jira-event' } });
    h.getTicket.mockResolvedValue({ ...ticket, key: 'ITS-6265' });
    await buildTicketBundle({ ...job(), ticketKey: 'ITS-6265' });
    expect((h.store.get('bundle:ITS-6265') as ContextBundle).summary?.origin).toBe('llm');
  });

  it('reuses the previous claims without a call when the prompt is unchanged', async () => {
    setStatus({});
    await buildTicketBundle(job());
    setStatus({ buildId: 'build-b' });
    h.generateClaims.mockClear();
    await buildTicketBundle(job('build-b'));
    expect(h.generateClaims).not.toHaveBeenCalled();
    expect(bundle()!.summary!.generatedClaims).toEqual(generated);
    expect(bundle()!.buildId).toBe('build-b');
  });

  it('calls the model again when a source changes', async () => {
    setStatus({});
    await buildTicketBundle(job());
    h.searchIncidents.mockResolvedValue([{ ...incident('ITO-1'), summary: 'new excerpt' }]);
    setStatus({ buildId: 'build-b' });
    await buildTicketBundle(job('build-b'));
    expect(h.generateClaims).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a stored summary that was not generated live (for example the removed step 8a demo summary)', async () => {
    h.store.set('bundle:ITS-1', { ticketKey: 'ITS-1', summary: { origin: 'demo-fixture', generatedClaims: [] } });
    setStatus({});
    await buildTicketBundle(job());
    expect(h.generateClaims).toHaveBeenCalledTimes(1);
    expect(bundle()!.summary!.origin).toBe('llm');
  });

  it('makes no call and stores no summary when there are no sources', async () => {
    h.searchIncidents.mockResolvedValue([]);
    h.searchResolutions.mockResolvedValue([]);
    setStatus({});
    await buildTicketBundle(job());
    expect(h.generateClaims).not.toHaveBeenCalled();
    expect(bundle()!.summary).toBeUndefined();
  });

  it('stores no summary when the model returns no claims', async () => {
    h.generateClaims.mockResolvedValue({ claims: [], model: 'm' });
    setStatus({});
    await buildTicketBundle(job());
    expect(bundle()!.summary).toBeUndefined();
  });

  it('on a generation failure stores the sources without a summary, not partial, and completes', async () => {
    h.generateClaims.mockRejectedValue(new Error('generation-http-503'));
    setStatus({});
    await buildTicketBundle(job());
    const b = bundle()!;
    expect(b.summary).toBeUndefined();
    expect(b.incidents).toHaveLength(1);
    expect(b.partial).toBe(false);
    expect(b.failures).toEqual([]);
    expect(status().status).toBe('complete');
  });

  it('still generates when the previous bundle cannot be read', async () => {
    setStatus({});
    const get = h.store.get.bind(h.store);
    const spy = vi.spyOn(h.store, 'get').mockImplementation((key: string) => {
      if (key === 'bundle:ITS-1') throw new Error('kvs down');
      return get(key);
    });
    try {
      await buildTicketBundle(job());
    } finally {
      spy.mockRestore();
    }
    expect(h.generateClaims).toHaveBeenCalledTimes(1);
  });

  it('discards a summary generated while the ticket changed (stale check runs after generation)', async () => {
    setStatus({});
    h.getTicket.mockResolvedValueOnce(ticket).mockResolvedValueOnce({ ...ticket, summary: 'Changed during generation' });
    await buildTicketBundle(job());
    expect(h.generateClaims).toHaveBeenCalledTimes(1);
    expect(bundle()).toBeUndefined();
    expect(status().status).toBe('superseded');
  });
});

describe('fingerprint and supersession (spec §8.2, §8.4)', () => {
  it('stores the fingerprint of the ticket the bundle was built from', async () => {
    setStatus({});
    await buildTicketBundle(job());
    expect(bundle()!.ticketFingerprint).toBe(ticketFingerprint(ticket));
  });

  it('re-fetches the ticket before writing', async () => {
    setStatus({});
    await buildTicketBundle(job());
    expect(h.getTicket).toHaveBeenCalledTimes(2);
  });

  it('writes normally when only a field outside the fingerprint changed', async () => {
    setStatus({});
    h.getTicket.mockResolvedValueOnce(ticket).mockResolvedValueOnce({ ...ticket, updatedAt: 'later' });
    await buildTicketBundle(job());
    expect(bundle()).toBeDefined();
    expect(status().status).toBe('complete');
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
  });

  it('discards a stale result, marks the build superseded and queues a fresh build', async () => {
    setStatus({});
    h.getTicket.mockResolvedValueOnce(ticket).mockResolvedValueOnce({ ...ticket, summary: 'Cannot log in since the outage' });
    h.enqueueTicketBuild.mockImplementation(async () => {
      // The superseded status must be written before the fresh build is queued.
      expect(status().status).toBe('superseded');
      return { buildId: 'build-next', requestedAt: 'r2' };
    });
    await buildTicketBundle(job());
    expect(bundle()).toBeUndefined();
    expect(h.enqueueTicketBuild).toHaveBeenCalledWith('ITS-1', { source: 'jira-event' });
  });

  it('does not queue another build when a newer build already owns the status', async () => {
    setStatus({});
    h.getTicket.mockResolvedValueOnce(ticket).mockImplementationOnce(async () => {
      // The edit that changed the ticket also fired an event, which queued a newer build.
      setStatus({ buildId: 'build-newer', status: 'queued' });
      return { ...ticket, summary: 'Changed' };
    });
    await buildTicketBundle(job('build-a'));
    expect(h.enqueueTicketBuild).not.toHaveBeenCalled();
    expect(bundle()).toBeUndefined();
    expect(status().buildId).toBe('build-newer');
  });

  it('marks the build failed if the re-fetch fails', async () => {
    setStatus({});
    h.getTicket.mockResolvedValueOnce(ticket).mockRejectedValueOnce(new Error('jira-get-503'));
    await buildTicketBundle(job());
    expect(bundle()).toBeUndefined();
    expect(status().status).toBe('failed');
  });
});

describe('site settings (spec Phase 5.5)', () => {
  it('passes the saved settings to every Jira call', async () => {
    setStatus({});
    await buildTicketBundle(job());
    const settings = { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], affectedServicesField: 'customfield_10039', requestTypeField: 'customfield_10010' };
    expect(h.getTicket).toHaveBeenCalledWith('ITS-1', settings);
    expect(h.searchIncidents.mock.calls[0][1]).toEqual(settings);
    expect(h.searchResolutions.mock.calls[0][1]).toEqual(settings);
  });

  it.each([
    ['the site was unconfigured after the job was queued', undefined],
    ['the project was removed from the bundle projects', { bundleProjects: ['SUP'], sourceProjects: ['SUP'], savedAt: 't' }],
  ])('builds nothing when %s', async (_why, settings) => {
    if (settings) h.store.set('settings:site', settings);
    else h.store.delete('settings:site');
    setStatus({});
    await buildTicketBundle(job());
    expect(h.getTicket).not.toHaveBeenCalled();
    expect(bundle()).toBeUndefined();
    expect(status()).toMatchObject({ status: 'failed', error: 'not-configured' });
  });
});

describe('knowledge articles (step 10)', () => {
  const article = { source: { kind: 'confluence-page' as const, id: '4194312', url: 'https://x/wiki/p/4194312', title: 'Auth runbook', updatedAt: 'u' }, excerpt: 'Check the auth service.', kind: 'runbook' as const, relevance: 0.4 };

  it('searches the configured spaces, stores the articles and offers them to the summary as sources', async () => {
    h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], confluenceSpaces: ['ITO'], savedAt: 't' });
    h.searchArticles.mockResolvedValue([article]);
    setStatus({});
    await buildTicketBundle(job());
    expect(h.searchArticles).toHaveBeenCalledWith(ticket, expect.objectContaining({ confluenceSpaces: ['ITO'] }), expect.any(Date));
    expect(bundle()!.articles).toEqual([article]);
    const labels = h.generateClaims.mock.calls[0][0].labels as Record<string, { id: string }>;
    expect(Object.values(labels).map((r) => r.id)).toContain('4194312');
  });

  it('does not search Confluence when no spaces are configured', async () => {
    setStatus({});
    await buildTicketBundle(job());
    expect(h.searchArticles).not.toHaveBeenCalled();
    expect(bundle()!.articles).toEqual([]);
  });

  it('a Confluence failure keeps the Jira sections and marks only that section failed', async () => {
    h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS'], confluenceSpaces: ['ITO'], savedAt: 't' });
    h.searchArticles.mockRejectedValue(new Error('confluence-recent-500'));
    setStatus({});
    await buildTicketBundle(job());
    expect(bundle()!.incidents).toHaveLength(1);
    expect(bundle()!.failures).toEqual(['confluence-articles']);
    expect(bundle()!.partial).toBe(true);
  });
});

describe('embeddings (step 12)', () => {
  const article = (id: string, title: string): Article => ({ source: { kind: 'confluence-page', id, url: `https://x/wiki/${id}`, title, updatedAt: '2026-11-01T00:00:00Z' }, excerpt: 'e', kind: 'runbook', relevance: 0.5 });
  // Unit vectors at chosen angles from the ticket vector [1, 0]: the cosine is the first component.
  const at = (c: number) => [c, Math.sqrt(1 - c * c)];

  it('re-ranks with embedding similarity, drops articles below the floor, and sends minimized text', async () => {
    setStatus({});
    h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], confluenceSpaces: ['ITO'], savedAt: 't' });
    h.getTicket.mockResolvedValue({ ...ticket, description: 'Mail me at a@b.com' });
    h.searchIncidents.mockResolvedValue([incident('ITO-1'), incident('ITO-3')]);
    h.searchArticles.mockResolvedValue([article('1', 'Auth runbook'), article('2', 'VPN runbook')]);
    // Order sent: incidents, resolutions, articles. ITO-3 is closer than ITO-1 (75% of it, above the floor); the Auth runbook
    // is below 60% of the VPN one.
    h.embedTicketAndCandidates.mockResolvedValue({ ticket: [1, 0], candidates: [at(0.6), at(0.8), at(0.5), at(0.2), at(0.7)], tokens: 321 });
    await buildTicketBundle(job());
    const [ticketText, texts] = h.embedTicketAndCandidates.mock.calls[0];
    expect(ticketText).toBe('Cannot log in Mail me at [email]');
    expect(texts).toEqual(['ITO-1 s', 'ITO-3 s', 'ITO-2 Root cause: x', 'Auth runbook e', 'VPN runbook e']);
    const b = bundle()!;
    expect(b.incidents.map((i) => i.source.id)).toEqual(['ITO-3', 'ITO-1']);
    expect(b.articles.map((a) => a.source.id)).toEqual(['2']);
    expect(b.partial).toBe(false);
  });

  it('keeps the keyword ranking when embeddings fail, without marking the bundle partial (spec 12.5)', async () => {
    setStatus({});
    h.searchIncidents.mockResolvedValue([incident('ITO-1'), incident('ITO-3')]);
    h.embedTicketAndCandidates.mockRejectedValue(new Error('embedding-http-429'));
    await buildTicketBundle(job());
    const b = bundle()!;
    expect(b.incidents.map((i) => i.source.id)).toEqual(['ITO-1', 'ITO-3']);
    expect(b.partial).toBe(false);
    expect(b.failures).toEqual([]);
    expect(status().status).toBe('complete');
  });

  it('makes no embedding call when there are no candidates', async () => {
    setStatus({});
    h.searchIncidents.mockResolvedValue([]);
    h.searchResolutions.mockResolvedValue([]);
    await buildTicketBundle(job());
    expect(h.embedTicketAndCandidates).not.toHaveBeenCalled();
    expect(status().status).toBe('complete');
  });
});