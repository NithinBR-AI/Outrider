// The reconciliation run (spec §8.7): reads statuses and bundles a page at a time, repairs through normal builds,
// deletes only on a 404, and saves where it stopped. Storage, Jira and the queue are simulated.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildStatus, Ticket } from '../../domain/types';
import { ticketFingerprint } from '../../domain/extract';

const h = vi.hoisted(() => ({
  settings: undefined as unknown,
  statuses: [] as BuildStatus[],
  bundles: [] as { ticketKey: string; ticketFingerprint: string }[],
  locks: new Map<string, { expiresAt: string }>(),
  tickets: new Map<string, unknown>(),
  missing: new Set<string>(),
  checkpoint: {} as { statusCursor?: string; bundleCursor?: string },
  savedCheckpoint: undefined as unknown,
  runLockHeld: false,
  pageSize: 2,
  enqueue: vi.fn(),
  deleted: [] as string[],
  released: 0,
  currentTicketsCalls: [] as string[][],
}));

// Pages are slices of the arrays; a cursor is the index of the next record.
const pageOf = <T>(items: T[], limit: number, cursor?: string) => {
  const start = cursor ? Number(cursor) : 0;
  const end = start + Math.min(limit, h.pageSize);
  return { values: items.slice(start, end), nextCursor: end < items.length ? String(end) : undefined };
};

vi.mock('../../adapters/settings', () => ({ getSettings: async () => h.settings }));
vi.mock('../../adapters/storage', () => ({
  acquireLock: async () => (h.runLockHeld ? undefined : { buildId: 'r' }),
  releaseLock: async () => void h.released++,
  getLock: async (key: string) => h.locks.get(key),
  getStatus: async (key: string) => h.statuses.find((s) => s.ticketKey === key),
  listStatusPage: async (limit: number, cursor?: string) => pageOf(h.statuses, limit, cursor),
  listBundlePage: async (limit: number, cursor?: string) => pageOf(h.bundles, limit, cursor),
  deleteTicketRecords: async (key: string) => void h.deleted.push(key),
  getReconcileCheckpoint: async () => h.checkpoint,
  putReconcileCheckpoint: async (c: unknown) => void (h.savedCheckpoint = c),
}));
vi.mock('../../adapters/jira', () => ({
  currentTickets: async (keys: string[]) => {
    h.currentTicketsCalls.push(keys);
    return new Map(keys.filter((k) => h.tickets.has(k)).map((k) => [k, h.tickets.get(k)]));
  },
  ticketExists: async (key: string) => !h.missing.has(key),
}));
vi.mock('../enqueue', () => ({ enqueueTicketBuild: h.enqueue }));

import { runReconcile, RECONCILE_TIME_BUDGET_MS } from '../reconcile';

const NOW = new Date('2026-11-25T10:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const job = { kind: 'reconcile' as const, buildId: 'run-1', requestedAt: NOW.toISOString(), actor: { source: 'reconcile' as const } };
const status = (key: string, s: Partial<BuildStatus>): BuildStatus => ({ ticketKey: key, buildId: 'b', requestedAt: minutesAgo(60), status: 'complete', actor: { source: 'jira-event' }, ...s });
const ticket = (key: string, summary = 'Cannot log in'): Ticket => ({ key, projectKey: key.split('-')[0], summary, description: '', labels: [], serviceIds: [], status: 'Open', updatedAt: 't' });

beforeEach(() => {
  h.settings = { bundleProjects: ['ITS'], sourceProjects: ['ITS'], savedAt: 't' };
  h.statuses = [];
  h.bundles = [];
  h.locks = new Map();
  h.tickets = new Map();
  h.missing = new Set();
  h.checkpoint = {};
  h.savedCheckpoint = undefined;
  h.runLockHeld = false;
  h.pageSize = 2;
  h.enqueue.mockReset().mockResolvedValue({ buildId: 'new', requestedAt: 't' });
  h.deleted = [];
  h.released = 0;
  h.currentTicketsCalls = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('runReconcile: build statuses', () => {
  it('re-queues stuck and failed builds as repair attempts, and leaves the rest', async () => {
    h.statuses = [
      status('ITS-1', { status: 'building', requestedAt: minutesAgo(30) }), // stuck, no lock
      status('ITS-2', { status: 'building', requestedAt: minutesAgo(30) }), // live lock
      status('ITS-3', { status: 'failed', error: 'build-failed', attempt: 1 }),
      status('ITS-4', { status: 'complete' }),
      status('HR-1', { status: 'failed', error: 'build-failed' }), // project does not get context
    ];
    h.locks.set('ITS-2', { expiresAt: new Date(NOW.getTime() + 60_000).toISOString() });
    h.locks.set('ITS-1', { expiresAt: minutesAgo(5) }); // expired lock counts as no lock
    const counts = await runReconcile(job, NOW);
    expect(h.enqueue.mock.calls).toEqual([
      ['ITS-1', { source: 'reconcile' }, 1],
      ['ITS-3', { source: 'reconcile' }, 2],
    ]);
    expect(counts).toMatchObject({ statusesChecked: 5, stuck: 1, failed: 1 });
    expect(h.released).toBe(1);
  });
});

describe('runReconcile: bundles', () => {
  it('rebuilds a bundle whose ticket changed, and leaves unchanged ones and running builds alone', async () => {
    h.tickets.set('ITS-1', ticket('ITS-1', 'Cannot log in - edited'));
    h.tickets.set('ITS-2', ticket('ITS-2'));
    h.tickets.set('ITS-3', ticket('ITS-3', 'changed too'));
    h.bundles = [
      { ticketKey: 'ITS-1', ticketFingerprint: ticketFingerprint(ticket('ITS-1')) },
      { ticketKey: 'ITS-2', ticketFingerprint: ticketFingerprint(ticket('ITS-2')) },
      { ticketKey: 'ITS-3', ticketFingerprint: ticketFingerprint(ticket('ITS-3')) },
    ];
    h.statuses = [status('ITS-3', { status: 'building', requestedAt: minutesAgo(1) })];
    const counts = await runReconcile(job, NOW);
    expect(h.enqueue.mock.calls).toEqual([['ITS-1', { source: 'reconcile' }, 1]]);
    expect(counts).toMatchObject({ bundlesChecked: 3, stale: 1, deleted: 0 });
  });

  it('deletes the records of a ticket Jira says does not exist, and only on a 404', async () => {
    h.bundles = [{ ticketKey: 'ITS-8', ticketFingerprint: 'f' }, { ticketKey: 'ITS-9', ticketFingerprint: 'f' }];
    h.missing.add('ITS-8'); // 404
    // ITS-9 is not returned by the search but exists: moved or not visible to the app. Left alone.
    const counts = await runReconcile(job, NOW);
    expect(h.deleted).toEqual(['ITS-8']);
    expect(counts).toMatchObject({ bundlesChecked: 2, deleted: 1, stale: 0 });
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('skips bundles of projects that no longer get context without asking Jira', async () => {
    h.bundles = [{ ticketKey: 'HR-1', ticketFingerprint: 'f' }];
    const counts = await runReconcile(job, NOW);
    expect(h.currentTicketsCalls).toEqual([]);
    expect(counts.bundlesChecked).toBe(0);
  });
});

describe('runReconcile: paging, checkpoint and limits', () => {
  it('continues from the saved cursors and saves where it stopped', async () => {
    h.pageSize = 1;
    h.statuses = Array.from({ length: 15 }, (_, i) => status(`ITS-${i + 1}`, {}));
    h.bundles = Array.from({ length: 6 }, (_, i) => ({ ticketKey: `ITS-${i + 1}`, ticketFingerprint: 'f' }));
    h.checkpoint = { statusCursor: '2', bundleCursor: '1' };
    await runReconcile(job, NOW);
    // 10 status pages of 1 from index 2, then 4 bundle batches of 1 from index 1.
    expect(h.savedCheckpoint).toEqual({ statusCursor: '12', bundleCursor: '5' });
    expect(h.currentTicketsCalls).toEqual([['ITS-2'], ['ITS-3'], ['ITS-4'], ['ITS-5']]);
  });

  it('starts over when it reaches the end of the records', async () => {
    h.statuses = [status('ITS-1', {})];
    h.bundles = [{ ticketKey: 'ITS-1', ticketFingerprint: 'f' }];
    h.checkpoint = { statusCursor: '0', bundleCursor: '0' };
    await runReconcile(job, NOW);
    expect(h.savedCheckpoint).toEqual({ statusCursor: undefined, bundleCursor: undefined });
  });

  it('stops between pages once its time budget is used up', async () => {
    h.pageSize = 1;
    h.statuses = [status('ITS-1', {}), status('ITS-2', {}), status('ITS-3', {})];
    h.bundles = [{ ticketKey: 'ITS-1', ticketFingerprint: 'f' }];
    let t = 0;
    const clock = () => (t += RECONCILE_TIME_BUDGET_MS / 2); // the budget is gone after the first page
    const counts = await runReconcile(job, NOW, clock);
    expect(counts.statusesChecked).toBe(1);
    expect(counts.bundlesChecked).toBe(0);
    expect(h.savedCheckpoint).toEqual({ statusCursor: '1', bundleCursor: undefined });
  });

  it('does nothing without settings, or while another run holds the lock', async () => {
    h.settings = undefined;
    expect(await runReconcile(job, NOW)).toMatchObject({ skipped: 'not-set-up' });
    h.settings = { bundleProjects: ['ITS'], sourceProjects: ['ITS'], savedAt: 't' };
    h.runLockHeld = true;
    expect(await runReconcile(job, NOW)).toMatchObject({ skipped: 'locked' });
    expect(h.savedCheckpoint).toBeUndefined();
    expect(h.released).toBe(0);
  });

  it('releases the lock when a step fails, and lets the failure fail the job', async () => {
    h.bundles = [{ ticketKey: 'ITS-1', ticketFingerprint: 'f' }];
    h.tickets.set('ITS-1', ticket('ITS-1'));
    h.enqueue.mockRejectedValue(new Error('queue down'));
    await expect(runReconcile(job, NOW)).rejects.toThrow('queue down');
    expect(h.released).toBe(1);
  });
});
