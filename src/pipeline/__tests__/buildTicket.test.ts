// Ticket builder tests (spec §8.3, §19.2): failure isolation, duplicate delivery, stale results.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildStatus, ContextBundle, Incident, Resolution, Ticket } from '../../domain/types';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  getTicket: vi.fn(),
  searchIncidents: vi.fn(),
  searchResolutions: vi.fn(),
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

import { buildTicketBundle } from '../buildTicket';

const ticket: Ticket = { key: 'ITS-1', projectKey: 'ITS', summary: 'Cannot log in', description: '', labels: [], serviceIds: [], status: 'Open', updatedAt: 'u' };
const ref = (id: string) => ({ kind: 'jira-issue' as const, id, url: `https://x/browse/${id}`, title: id, updatedAt: 'u' });
const incident = (id: string): Incident => ({ source: ref(id), status: 'active', summary: 's', startedAt: 't' });
const resolution = (id: string): Resolution => ({ source: ref(id), resolvedAt: 't', resolutionText: 'Root cause: x', matchReason: 'same-symptom' });
const job = (buildId = 'build-a') => ({ kind: 'jira-ticket' as const, ticketKey: 'ITS-1', buildId, requestedAt: 'r', actor: { source: 'jira-event' as const } });
const setStatus = (s: Partial<BuildStatus>) => h.store.set('status:ITS-1', { ticketKey: 'ITS-1', buildId: 'build-a', requestedAt: 'r', status: 'queued', actor: { source: 'jira-event' }, ...s });
const status = () => h.store.get('status:ITS-1') as BuildStatus;
const bundle = () => h.store.get('bundle:ITS-1') as ContextBundle | undefined;

beforeEach(() => {
  h.store.clear();
  h.getTicket.mockReset().mockResolvedValue(ticket);
  h.searchIncidents.mockReset().mockResolvedValue([incident('ITO-1')]);
  h.searchResolutions.mockReset().mockResolvedValue([resolution('ITO-2')]);
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
});
