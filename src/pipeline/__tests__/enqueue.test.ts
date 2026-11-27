// Event handler and queue producer tests (spec §6.2).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  push: vi.fn(),
  queueKeys: [] as string[],
}));

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => h.store.get(key),
    set: async (key: string, value: unknown) => void h.store.set(key, value),
  },
}));
vi.mock('@forge/events', () => ({
  Queue: class {
    constructor(params: { key: string }) {
      h.queueKeys.push(params.key);
    }
    push = h.push;
  },
}));

import { BUILD_QUEUE_KEY, CLUSTER_PASS_DELAY_SECONDS, enqueueTicketBuild, LOCK_RETRY_DELAY_SECONDS, onClusterSweep, onJiraIssueEvent, onReconcileSweep, requeueClusterJob, requeueTicketJob } from '../enqueue';
import { BuildStatus } from '../../domain/types';

const statusOf = (key: string) => h.store.get(`status:${key}`) as BuildStatus | undefined;

beforeEach(() => {
  h.store.clear();
  h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], affectedServicesField: 'customfield_10039', requestTypeField: 'customfield_10010', savedAt: 't' }); // explicit site settings (Phase 5.5)
  h.push.mockReset();
  h.push.mockResolvedValue({ jobId: 'job-1' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('reconciliation', () => {
  it('the hourly sweep queues one reconcile run', async () => {
    await onReconcileSweep();
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push.mock.calls[0][0].body).toMatchObject({ kind: 'reconcile', actor: { source: 'reconcile' } });
  });

  it('a repair build records its attempt; a ticket event records none, which resets the count', async () => {
    await enqueueTicketBuild('ITS-1', { source: 'reconcile' }, 2);
    expect(statusOf('ITS-1')).toMatchObject({ status: 'queued', attempt: 2 });
    await onJiraIssueEvent({ eventType: 'avi:jira:updated:issue', issue: { key: 'ITS-1' } });
    expect(statusOf('ITS-1')).not.toHaveProperty('attempt');
  });
});

describe('onJiraIssueEvent', () => {
  it('uses the queue key the manifest consumer listens on', () => {
    expect(h.queueKeys).toContain(BUILD_QUEUE_KEY);
    expect(BUILD_QUEUE_KEY).toBe('outrider-build-queue');
  });

  it('writes a queued status and pushes a jira-ticket job', async () => {
    await onJiraIssueEvent({ eventType: 'avi:jira:updated:issue', atlassianId: 'user-1', issue: { key: 'ITS-6265' } });
    const s = statusOf('ITS-6265')!;
    expect(s.status).toBe('queued');
    // The event's atlassianId is never stored or queued (user privacy guide: no stored account IDs).
    expect(s.actor).toEqual({ source: 'jira-event' });
    expect(JSON.stringify(h.push.mock.calls)).not.toContain('user-1');
    expect(h.push).toHaveBeenCalledTimes(2);
    const body = h.push.mock.calls[0][0].body;
    expect(body).toMatchObject({ kind: 'jira-ticket', ticketKey: 'ITS-6265', buildId: s.buildId, requestedAt: s.requestedAt });
    // Step 13: and one clustering pass for the ticket's project, after a short delay.
    expect(h.push.mock.calls[1][0]).toMatchObject({ body: { kind: 'cluster-pass', projectKey: 'ITS', actor: { source: 'jira-event' } }, delayInSeconds: CLUSTER_PASS_DELAY_SECONDS });
  });

  it('queues no clustering pass when neither a service field nor an entity field is configured', async () => {
    h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS'], savedAt: 't' });
    await onJiraIssueEvent({ issue: { key: 'ITS-6265' } });
    expect(h.push.mock.calls.map((c) => c[0].body.kind)).toEqual(['jira-ticket']);
    h.push.mockClear();
    h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS'], clusterEntityField: 'components', savedAt: 't' });
    await onJiraIssueEvent({ issue: { key: 'ITS-6265' } });
    expect(h.push.mock.calls.map((c) => c[0].body.kind)).toEqual(['jira-ticket', 'cluster-pass']);
  });

  it('a failed clustering enqueue does not fail the event: the ticket build is already queued', async () => {
    h.push.mockResolvedValueOnce({ jobId: 'job-1' }).mockRejectedValueOnce(new Error('queue down'));
    await expect(onJiraIssueEvent({ issue: { key: 'ITS-6265' } })).resolves.toBeUndefined();
    expect(statusOf('ITS-6265')!.status).toBe('queued');
  });

  it('ignores self-generated events', async () => {
    await onJiraIssueEvent({ selfGenerated: true, issue: { key: 'ITS-6265' } });
    expect(h.push).not.toHaveBeenCalled();
    expect(statusOf('ITS-6265')).toBeUndefined();
  });

  it('ignores events without an issue key', async () => {
    await onJiraIssueEvent({ eventType: 'avi:jira:updated:issue' });
    expect(h.push).not.toHaveBeenCalled();
  });

  it('ignores tickets outside the bundle projects', async () => {
    await onJiraIssueEvent({ issue: { key: 'ITO-9647' } });
    expect(h.push).not.toHaveBeenCalled();
    expect(statusOf('ITO-9647')).toBeUndefined();
  });

  it('records the actor as absent when the event has none', async () => {
    await onJiraIssueEvent({ issue: { key: 'ITS-1' } });
    expect(statusOf('ITS-1')!.actor).toEqual({ accountId: undefined, source: 'jira-event' });
  });
});

describe('requeueTicketJob', () => {
  const job = { kind: 'jira-ticket' as const, ticketKey: 'ITS-1', buildId: 'b1', requestedAt: 'r', actor: { source: 'jira-event' as const } };

  it('pushes the same job with a 30 second delay and leaves the status alone', async () => {
    await requeueTicketJob(job);
    expect(LOCK_RETRY_DELAY_SECONDS).toBe(30);
    expect(h.push).toHaveBeenCalledWith({ body: job, delayInSeconds: LOCK_RETRY_DELAY_SECONDS });
    expect(statusOf('ITS-1')).toBeUndefined();
  });

  it('accepts a custom delay', async () => {
    await requeueTicketJob(job, 5);
    expect(h.push).toHaveBeenCalledWith({ body: job, delayInSeconds: 5 });
  });
});

describe('enqueueTicketBuild', () => {
  it('generates a unique build ID per build', async () => {
    const a = await enqueueTicketBuild('ITS-1', { source: 'unknown' });
    const b = await enqueueTicketBuild('ITS-1', { source: 'unknown' });
    expect(a.buildId).not.toBe(b.buildId);
    expect(a.buildId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('marks enqueue_failed and rethrows when the push fails', async () => {
    h.push.mockRejectedValueOnce(new Error('queue down'));
    await expect(enqueueTicketBuild('ITS-1', { source: 'unknown' })).rejects.toThrow('queue down');
    expect(statusOf('ITS-1')!.status).toBe('enqueue_failed');
    expect(statusOf('ITS-1')!.error).toBe('queue-push-failed');
  });

  it('does not mark enqueue_failed if another build took over the status meanwhile', async () => {
    h.push.mockImplementationOnce(async () => {
      // A newer build writes its own status while this push is in flight.
      h.store.set('status:ITS-1', { ticketKey: 'ITS-1', buildId: 'newer', requestedAt: 'x', status: 'queued', actor: { source: 'unknown' } });
      throw new Error('queue down');
    });
    await expect(enqueueTicketBuild('ITS-1', { source: 'unknown' })).rejects.toThrow();
    expect(statusOf('ITS-1')!.buildId).toBe('newer');
    expect(statusOf('ITS-1')!.status).toBe('queued');
  });
});

describe('site settings (spec Phase 5.5)', () => {
  it('builds nothing when the site is not set up', async () => {
    h.store.delete('settings:site');
    await onJiraIssueEvent({ eventType: 'avi:jira:updated:issue', issue: { key: 'ITS-6265' } });
    expect(h.push).not.toHaveBeenCalled();
    expect(statusOf('ITS-6265')).toBeUndefined();
  });

  it('follows the configured projects: SUP builds, other projects do not', async () => {
    h.store.set('settings:site', { bundleProjects: ['SUP'], sourceProjects: ['SUP', 'INC'], savedAt: 't' });
    await onJiraIssueEvent({ issue: { key: 'SUP-12' } });
    await onJiraIssueEvent({ issue: { key: 'INC-3' } });
    await onJiraIssueEvent({ issue: { key: 'ITS-6265' } });
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push.mock.calls[0][0].body).toMatchObject({ ticketKey: 'SUP-12' });
  });
});

describe('clustering passes (step 13)', () => {
  it('the hourly sweep queues one immediate pass per context project', async () => {
    h.store.set('settings:site', { bundleProjects: ['ITS', 'HR'], sourceProjects: ['ITS'], affectedServicesField: 'customfield_10039', savedAt: 't' });
    await onClusterSweep();
    expect(h.push.mock.calls.map((c) => [c[0].body.kind, c[0].body.projectKey, c[0].delayInSeconds])).toEqual([['cluster-pass', 'ITS', 0], ['cluster-pass', 'HR', 0]]);
  });

  it('the sweep does nothing without settings or without an identity field', async () => {
    h.store.delete('settings:site');
    await onClusterSweep();
    h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS'], savedAt: 't' });
    await onClusterSweep();
    expect(h.push).not.toHaveBeenCalled();
  });

  it('re-queues a locked pass unchanged after the lock retry delay', async () => {
    const job = { kind: 'cluster-pass' as const, projectKey: 'ITS', buildId: 'b', requestedAt: 'r', actor: { source: 'unknown' as const } };
    await requeueClusterJob(job);
    expect(h.push).toHaveBeenCalledWith({ body: job, delayInSeconds: LOCK_RETRY_DELAY_SECONDS });
  });
});
