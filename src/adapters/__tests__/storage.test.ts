// Storage tests with an in-memory KVS.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildStatus, ContextBundle } from '../../domain/types';

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => store.get(key),
    set: async (key: string, value: unknown) => void store.set(key, value),
  },
}));

import { getBundle, getStatus, putBundle, putStatus, updateStatusIf } from '../storage';

const status = (overrides: Partial<BuildStatus> = {}): BuildStatus => ({
  ticketKey: 'ITS-1',
  buildId: 'build-a',
  requestedAt: '2026-11-20T10:00:00.000Z',
  status: 'queued',
  actor: { accountId: 'user-1', source: 'jira-event' },
  ...overrides,
});

beforeEach(() => store.clear());

describe('bundle and status keys', () => {
  it('namespaces keys per ticket', async () => {
    await putStatus(status());
    await putBundle({ ticketKey: 'ITS-1' } as ContextBundle);
    expect([...store.keys()].sort()).toEqual(['bundle:ITS-1', 'status:ITS-1']);
  });

  it('returns undefined for unknown tickets', async () => {
    expect(await getStatus('ITS-404')).toBeUndefined();
    expect(await getBundle('ITS-404')).toBeUndefined();
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
    expect(s.actor.accountId).toBe('user-1');
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
