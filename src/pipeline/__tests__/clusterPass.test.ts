// Clustering pass unit tests (step 13). Every adapter is mocked; tests/integration/clustering.test.ts runs the
// same pass against simulated storage end to end.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClusterRecord } from '../../domain/cluster';

const h = vi.hoisted(() => ({
  settings: undefined as unknown,
  source: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  requeue: vi.fn(),
}));

vi.mock('../../adapters/settings', () => ({ getSettings: async () => h.settings }));
vi.mock('../../adapters/clusterSource', () => ({ openRequestsForClustering: h.source }));
vi.mock('../../adapters/storage', () => ({ acquireLock: h.acquireLock, releaseLock: h.releaseLock, listClusterRecords: h.list, putClusterRecord: h.put, deleteClusterRecord: h.del }));
vi.mock('../enqueue', () => ({ requeueClusterJob: h.requeue }));

import { clusteringEnabled, clusterLockKey, runClusterPass } from '../clusterPass';

const NOW = new Date('2026-11-23T10:30:00.000Z');
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const job = { kind: 'cluster-pass' as const, projectKey: 'ITS', buildId: 'pass-1', requestedAt: 'r', actor: { source: 'jira-event' as const } };
const SETTINGS = { bundleProjects: ['ITS'], sourceProjects: ['ITS'], affectedServicesField: 'customfield_10039', clusterEntityField: 'components', clusterThreshold: 2 };
const pair = [
  { key: 'ITS-1', createdAt: ago(10), serviceIds: ['svc'], entities: [{ kind: 'component' as const, id: '10014' }] },
  { key: 'ITS-2', createdAt: ago(5), serviceIds: ['svc'], entities: [{ kind: 'component' as const, id: '10014' }] },
];
const logs = () => (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  h.settings = SETTINGS;
  h.source.mockReset().mockResolvedValue({ requests: pair, serviceNames: new Map([['svc', 'Infrastructure Services']]), entityNames: new Map([['10014', 'VPN Server']]) });
  h.acquireLock.mockReset().mockResolvedValue({ buildId: 'pass-1' });
  h.releaseLock.mockReset().mockResolvedValue(true);
  h.list.mockReset().mockResolvedValue([]);
  h.put.mockReset().mockResolvedValue(undefined);
  h.del.mockReset().mockResolvedValue(undefined);
  h.requeue.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('runClusterPass', () => {
  it('reads the window plus a margin, raises a named signal, logs the counts and releases the lock', async () => {
    await runClusterPass(job, NOW);
    expect(h.acquireLock).toHaveBeenCalledWith('cluster-pass_ITS', 'pass-1', expect.any(String), NOW);
    expect(h.source).toHaveBeenCalledWith('ITS', SETTINGS, 95); // default 90-minute window + 5
    const [written] = h.put.mock.calls.map((c) => c[0] as ClusterRecord);
    expect(written).toMatchObject({ lifecycle: 'raised', state: 'confirmed', threshold: 2, serviceName: 'Infrastructure Services', entityName: 'VPN Server' });
    expect(logs().some((l) => l.includes('cluster pass for ITS: 2 open request(s), window 90 min, threshold 2; raised 1, updated 0, expired 0, deleted 0'))).toBe(true);
    expect(h.releaseLock).toHaveBeenCalledWith('cluster-pass_ITS', h.acquireLock.mock.calls[0][2]);
  });

  it('writes nothing on a re-run over unchanged state', async () => {
    await runClusterPass(job, NOW);
    const stored = h.put.mock.calls.map((c) => c[0] as ClusterRecord);
    h.put.mockClear();
    h.list.mockResolvedValue(stored);
    await runClusterPass(job, NOW);
    expect(h.put).not.toHaveBeenCalled();
  });

  it('deletes long-ended records, but never one it is writing in the same pass', async () => {
    const old: ClusterRecord = { storageKey: 'cluster:ITS:old', signalId: 's', projectKey: 'ITS', identityType: 'confirmed', state: 'confirmed', serviceId: 'x', entityKind: 'component', entityId: 'y', windowStart: '2026-11-01T00:00:00.000Z', windowEnd: '2026-11-01T01:30:00.000Z', threshold: 2, raisedAt: 'r', lastUpdatedAt: 'r', lifecycle: 'expired', requestKeys: [], evidence: [] };
    h.list.mockResolvedValue([old]);
    await runClusterPass(job, NOW);
    expect(h.del).toHaveBeenCalledWith('cluster:ITS:old');
  });

  it('skips, without locking, a project that does not get context or a site with no identity field', async () => {
    await runClusterPass({ ...job, projectKey: 'HR' }, NOW);
    h.settings = { bundleProjects: ['ITS'], sourceProjects: ['ITS'] };
    await runClusterPass(job, NOW);
    h.settings = undefined;
    await runClusterPass(job, NOW);
    expect(h.acquireLock).not.toHaveBeenCalled();
    expect(h.source).not.toHaveBeenCalled();
  });

  it('re-queues itself, reading nothing, when another pass holds the lock', async () => {
    h.acquireLock.mockResolvedValue(undefined);
    await runClusterPass(job, NOW);
    expect(h.requeue).toHaveBeenCalledWith(job);
    expect(h.source).not.toHaveBeenCalled();
    expect(h.releaseLock).not.toHaveBeenCalled();
  });

  it('lets a source failure fail the job (the queue retries it) and still releases the lock', async () => {
    h.source.mockRejectedValue(new Error('cluster-search-503'));
    await expect(runClusterPass(job, NOW)).rejects.toThrow('cluster-search-503');
    expect(h.put).not.toHaveBeenCalled();
    expect(h.releaseLock).toHaveBeenCalled();
  });

  it('logs, and does not throw, when releasing the lock fails', async () => {
    h.releaseLock.mockRejectedValue(new Error('kvs down'));
    await expect(runClusterPass(job, NOW)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('cluster lock release failed for ITS', expect.any(Error));
  });

  it('uses the configured window when set', async () => {
    h.settings = { ...SETTINGS, clusterWindowMinutes: 1440 };
    await runClusterPass(job, NOW);
    expect(h.source).toHaveBeenCalledWith('ITS', expect.anything(), 1445);
  });
});

describe('helpers', () => {
  it('clustering needs settings and a service or entity field', () => {
    expect(clusteringEnabled(undefined)).toBe(false);
    expect(clusteringEnabled({ bundleProjects: ['ITS'], sourceProjects: ['ITS'] })).toBe(false);
    expect(clusteringEnabled({ bundleProjects: ['ITS'], sourceProjects: ['ITS'], affectedServicesField: 'customfield_1' })).toBe(true);
    expect(clusteringEnabled({ bundleProjects: ['ITS'], sourceProjects: ['ITS'], clusterEntityField: 'components' })).toBe(true);
  });

  it('the pass lock key can never collide with a ticket lock', () => {
    expect(clusterLockKey('ITS')).toBe('cluster-pass_ITS');
    expect(/^[A-Z][A-Z0-9_]+-\d+$/.test(clusterLockKey('ITS'))).toBe(false);
  });
});
