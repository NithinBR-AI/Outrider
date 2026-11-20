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

import { BUILD_QUEUE_KEY, enqueueTicketBuild, onJiraIssueEvent } from '../enqueue';
import { BuildStatus } from '../../domain/types';

const statusOf = (key: string) => h.store.get(`status:${key}`) as BuildStatus | undefined;

beforeEach(() => {
  h.store.clear();
  h.push.mockReset();
  h.push.mockResolvedValue({ jobId: 'job-1' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
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
    expect(s.actor).toEqual({ accountId: 'user-1', source: 'jira-event' });
    expect(h.push).toHaveBeenCalledTimes(1);
    const body = h.push.mock.calls[0][0].body;
    expect(body).toMatchObject({ kind: 'jira-ticket', ticketKey: 'ITS-6265', buildId: s.buildId, requestedAt: s.requestedAt });
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
