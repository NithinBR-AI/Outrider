// Ticket builder tests (spec §8.3, §19.2): failure isolation, duplicate delivery, stale results.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildStatus, ContextBundle, Incident, Resolution, Ticket } from '../../domain/types';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  getTicket: vi.fn(),
  searchIncidents: vi.fn(),
  searchResolutions: vi.fn(),
  enqueueTicketBuild: vi.fn(),
}));

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => h.store.get(key),
    set: async (key: string, value: unknown) => void h.store.set(key, value),
  },
}));
vi.mock('../../adapters/jira', () => ({
  getTicket: h.getTicket,
  searchIncidents: h.searchIncidents,
  searchResolutions: h.searchResolutions,
}));
vi.mock('../enqueue', () => ({ enqueueTicketBuild: h.enqueueTicketBuild }));

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
  h.getTicket.mockReset().mockResolvedValue(ticket);
  h.searchIncidents.mockReset().mockResolvedValue([incident('ITO-1')]);
  h.searchResolutions.mockReset().mockResolvedValue([resolution('ITO-2')]);
  h.enqueueTicketBuild.mockReset().mockResolvedValue({ buildId: 'build-next', requestedAt: 'r2' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
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
    const nowIncidents = h.searchIncidents.mock.calls[0][1] as Date;
    const nowResolutions = h.searchResolutions.mock.calls[0][1] as Date;
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

  it('marks the build failed if the re-fetch fails', async () => {
    setStatus({});
    h.getTicket.mockResolvedValueOnce(ticket).mockRejectedValueOnce(new Error('jira-get-503'));
    await buildTicketBundle(job());
    expect(bundle()).toBeUndefined();
    expect(status().status).toBe('failed');
  });
});
