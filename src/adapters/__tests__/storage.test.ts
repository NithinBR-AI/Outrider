// Storage tests with an in-memory KVS that mirrors the documented behavior we rely on:
// FAIL_IF_EXISTS rejects when the key exists, and expired keys are NOT removed (KVS deletes
// expired data asynchronously, so an expired lock record stays visible).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildStatus, ContextBundle } from '../../domain/types';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  setOptions: [] as { key: string; options?: Record<string, unknown> }[],
  failNextSet: null as null | Error,
  failSetsAfter: [] as Error[],
}));
vi.mock('@forge/kvs', () => ({
  WhereConditions: { beginsWith: (value: string) => ({ condition: 'BEGINS_WITH', value }) },
  kvs: {
    get: async (key: string) => h.store.get(key),
    set: async (key: string, value: unknown, options?: Record<string, unknown>) => {
      h.setOptions.push({ key, options });
      if (h.failNextSet) {
        const e = h.failNextSet;
        h.failNextSet = null;
        throw e;
      }
      const queued = h.failSetsAfter.shift();
      if (queued) throw queued;
      if (options?.keyPolicy === 'FAIL_IF_EXISTS' && h.store.has(key)) throw new Error('KVS conflict (code undocumented)');
      h.store.set(key, value);
    },
    delete: async (key: string) => void h.store.delete(key),
    // Begins-with query with limit and cursor; the cursor is the index of the next matching key.
    query: () => {
      let prefix = '';
      let limit = 100;
      let start = 0;
      const builder = {
        where: (_p: string, c: { value: string }) => ((prefix = c.value), builder),
        limit: (n: number) => ((limit = n), builder),
        cursor: (c: string) => ((start = Number(c)), builder),
        getMany: async () => {
          const all = [...h.store.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1));
          const end = start + limit;
          return { results: all.slice(start, end).map(([key, value]) => ({ key, value })), nextCursor: end < all.length ? String(end) : undefined };
        },
      };
      return builder;
    },
  },
}));

import {
  acquireLock,
  deleteTicketRecords,
  getBundle,
  getReconcileCheckpoint,
  listBundlePage,
  listStatusPage,
  putReconcileCheckpoint,
  getLock,
  getStatus,
  holdsLock,
  LOCK_LEASE_SECONDS,
  putBundle,
  putStatus,
  releaseLock,
  updateStatusIf,
} from '../storage';

const status = (overrides: Partial<BuildStatus> = {}): BuildStatus => ({
  ticketKey: 'ITS-1',
  buildId: 'build-a',
  requestedAt: '2026-11-20T10:00:00.000Z',
  status: 'queued',
  actor: { source: 'jira-event' },
  ...overrides,
});

const T0 = new Date('2026-11-21T10:00:00.000Z');
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

beforeEach(() => {
  h.failSetsAfter = [];
  h.store.clear();
  h.setOptions = [];
  h.failNextSet = null;
});

describe('bundle and status keys', () => {
  it('namespaces keys per ticket', async () => {
    await putStatus(status());
    await putBundle({ ticketKey: 'ITS-1' } as ContextBundle);
    expect([...h.store.keys()].sort()).toEqual(['bundle:ITS-1', 'status:ITS-1']);
  });

  it('returns undefined for unknown tickets', async () => {
    expect(await getStatus('ITS-404')).toBeUndefined();
    expect(await getBundle('ITS-404')).toBeUndefined();
  });
});

describe('reconciliation records', () => {
  it('lists statuses and bundles a page at a time, with a cursor for the next page', async () => {
    for (const n of [1, 2, 3]) {
      await putStatus(status({ ticketKey: `ITS-${n}` }));
      await putBundle({ ticketKey: `ITS-${n}`, ticketFingerprint: `f${n}`, incidents: [] } as unknown as ContextBundle);
    }
    const first = await listStatusPage(2);
    expect(first.values.map((s) => s.ticketKey)).toEqual(['ITS-1', 'ITS-2']);
    const second = await listStatusPage(2, first.nextCursor);
    expect(second.values.map((s) => s.ticketKey)).toEqual(['ITS-3']);
    expect(second.nextCursor).toBeUndefined();
    const bundles = await listBundlePage(5);
    expect(bundles.values).toEqual([1, 2, 3].map((n) => ({ ticketKey: `ITS-${n}`, ticketFingerprint: `f${n}` })));
  });

  it("deletes a ticket's bundle and status, and keeps the checkpoint", async () => {
    await putStatus(status());
    await putBundle({ ticketKey: 'ITS-1' } as ContextBundle);
    await deleteTicketRecords('ITS-1');
    expect(h.store.size).toBe(0);
    expect(await getReconcileCheckpoint()).toEqual({});
    await putReconcileCheckpoint({ statusCursor: '2' });
    expect(await getReconcileCheckpoint()).toEqual({ statusCursor: '2' });
  });
});

describe('updateStatusIf (best-effort guard, spec §6.2)', () => {
  it('writes when the build and expected state match', async () => {
    await putStatus(status());
    expect(await updateStatusIf('ITS-1', 'build-a', ['queued'], { status: 'building' })).toBe(true);
    expect((await getStatus('ITS-1'))!.status).toBe('building');
  });

  it('preserves requestedAt and actor across transitions', async () => {
    await putStatus(status());
    await updateStatusIf('ITS-1', 'build-a', ['queued'], { status: 'building' });
    const s = (await getStatus('ITS-1'))!;
    expect(s.requestedAt).toBe('2026-11-20T10:00:00.000Z');
    expect(s.actor).toEqual({ source: 'jira-event' });
  });

  it('does not write when a newer build owns the status', async () => {
    await putStatus(status({ buildId: 'build-b' }));
    expect(await updateStatusIf('ITS-1', 'build-a', ['queued'], { status: 'enqueue_failed' })).toBe(false);
    expect((await getStatus('ITS-1'))!.buildId).toBe('build-b');
  });

  it('does not overwrite building, complete or superseded with enqueue_failed', async () => {
    for (const s of ['building', 'complete', 'superseded'] as const) {
      await putStatus(status({ status: s }));
      expect(await updateStatusIf('ITS-1', 'build-a', ['queued'], { status: 'enqueue_failed' })).toBe(false);
      expect((await getStatus('ITS-1'))!.status).toBe(s);
    }
  });

  it('does nothing when no status exists', async () => {
    expect(await updateStatusIf('ITS-1', 'build-a', ['queued'], { status: 'building' })).toBe(false);
    expect(await getStatus('ITS-1')).toBeUndefined();
  });

  it('records the error code with the new state', async () => {
    await putStatus(status({ status: 'building' }));
    await updateStatusIf('ITS-1', 'build-a', ['building'], { status: 'failed', error: 'build-failed' });
    expect((await getStatus('ITS-1'))!.error).toBe('build-failed');
  });
});

describe('per-ticket lock (spec §8.5)', () => {
  it('acquires a free lock with an atomic create-if-absent write and a TTL', async () => {
    const lock = await acquireLock('ITS-1', 'build-a', 'token-a', T0);
    expect(lock).toEqual({ buildId: 'build-a', ownerToken: 'token-a', acquiredAt: T0.toISOString(), expiresAt: later(LOCK_LEASE_SECONDS).toISOString() });
    expect(h.setOptions[0]).toEqual({ key: 'lock:ITS-1', options: { keyPolicy: 'FAIL_IF_EXISTS', ttl: { unit: 'SECONDS', value: LOCK_LEASE_SECONDS } } });
    expect(await getLock('ITS-1')).toEqual(lock);
  });

  it('outlives the consumer timeout, so a running build never outlives its lease', () => {
    expect(LOCK_LEASE_SECONDS).toBeGreaterThan(600);
  });

  it('refuses a lock another acquisition holds', async () => {
    await acquireLock('ITS-1', 'build-a', 'token-a', T0);
    expect(await acquireLock('ITS-1', 'build-b', 'token-b', later(60))).toBeUndefined();
    expect((await getLock('ITS-1'))!.ownerToken).toBe('token-a');
  });

  it('refuses a second copy of the same build (different token)', async () => {
    await acquireLock('ITS-1', 'build-a', 'token-a1', T0);
    expect(await acquireLock('ITS-1', 'build-a', 'token-a2', later(1))).toBeUndefined();
  });

  it('takes over an expired lock that KVS has not swept yet (crash recovery)', async () => {
    await acquireLock('ITS-1', 'crashed-build', 'token-dead', T0);
    const lock = await acquireLock('ITS-1', 'build-b', 'token-b', later(LOCK_LEASE_SECONDS + 1));
    expect(lock?.ownerToken).toBe('token-b');
    expect((await getLock('ITS-1'))!.ownerToken).toBe('token-b');
  });

  it('does not take over a lease that expires exactly now', async () => {
    await acquireLock('ITS-1', 'build-a', 'token-a', T0);
    expect(await acquireLock('ITS-1', 'build-b', 'token-b', later(LOCK_LEASE_SECONDS - 1))).toBeUndefined();
  });

  it('rethrows a storage error that is not a conflict when the retry fails too', async () => {
    h.failNextSet = new Error('RATE_LIMIT_EXCEEDED');
    h.failSetsAfter = [new Error('RATE_LIMIT_EXCEEDED')];
    await expect(acquireLock('ITS-1', 'build-a', 'token-a', T0)).rejects.toThrow('RATE_LIMIT_EXCEEDED');
    expect(h.setOptions).toHaveLength(2);
  });

  it('acquires on the retry when the holder released the lock between the conflict and the re-read', async () => {
    // Seen live: "Provided key already exists and cannot be overwritten", and no lock left when re-read.
    h.failNextSet = new Error('Provided key already exists and cannot be overwritten');
    const lock = await acquireLock('ITS-1', 'build-b', 'token-b', T0);
    expect(lock?.ownerToken).toBe('token-b');
    expect((await getLock('ITS-1'))!.ownerToken).toBe('token-b');
    expect(h.setOptions.map((s) => s.options?.keyPolicy)).toEqual(['FAIL_IF_EXISTS', 'FAIL_IF_EXISTS']);
  });

  it('reports whether this acquisition still holds an unexpired lease', async () => {
    await acquireLock('ITS-1', 'build-a', 'token-a', T0);
    expect(await holdsLock('ITS-1', 'token-a', later(10))).toBe(true);
    expect(await holdsLock('ITS-1', 'token-other', later(10))).toBe(false);
    expect(await holdsLock('ITS-1', 'token-a', later(LOCK_LEASE_SECONDS + 1))).toBe(false);
    expect(await holdsLock('ITS-2', 'token-a', later(10))).toBe(false);
  });

  it('releases only a lock this acquisition owns', async () => {
    await acquireLock('ITS-1', 'build-a', 'token-a', T0);
    expect(await releaseLock('ITS-1', 'token-other')).toBe(false);
    expect(await getLock('ITS-1')).toBeDefined();
    expect(await releaseLock('ITS-1', 'token-a')).toBe(true);
    expect(await getLock('ITS-1')).toBeUndefined();
    expect(await releaseLock('ITS-1', 'token-a')).toBe(false);
  });

  it('can be acquired again after release', async () => {
    await acquireLock('ITS-1', 'build-a', 'token-a', T0);
    await releaseLock('ITS-1', 'token-a');
    expect((await acquireLock('ITS-1', 'build-b', 'token-b', later(5)))?.ownerToken).toBe('token-b');
  });
});
