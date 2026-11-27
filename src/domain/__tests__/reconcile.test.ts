// Reconciliation decisions (spec §8.7; found in review: nothing repaired a build that died mid-run).
import { describe, expect, it } from 'vitest';
import { bundleIsStale, canRepair, MAX_REPAIR_ATTEMPTS, nextAttempt, statusRepair, STUCK_AFTER_MINUTES } from '../reconcile';
import { BuildStatus } from '../types';

const NOW = new Date('2026-11-25T10:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const status = (s: Partial<BuildStatus>): BuildStatus => ({
  ticketKey: 'ITS-1', buildId: 'b', requestedAt: minutesAgo(60), status: 'complete', actor: { source: 'jira-event' }, ...s,
});

describe('statusRepair', () => {
  it.each(['queued', 'building', 'superseded'] as const)('re-queues a %s build stuck past the limit with no live lock', (s) => {
    expect(statusRepair(status({ status: s, requestedAt: minutesAgo(STUCK_AFTER_MINUTES) }), false, true, NOW)).toEqual({ action: 'requeue', reason: 'stuck' });
  });

  it('leaves a build that is still recent, or that holds a live lock', () => {
    expect(statusRepair(status({ status: 'building', requestedAt: minutesAgo(STUCK_AFTER_MINUTES - 1) }), false, true, NOW)).toEqual({ action: 'skip' });
    expect(statusRepair(status({ status: 'building', requestedAt: minutesAgo(60) }), true, true, NOW)).toEqual({ action: 'skip' });
  });

  it('treats an unreadable request time as stuck, so a bad record cannot block repairs forever', () => {
    expect(statusRepair(status({ status: 'queued', requestedAt: 'not a date' }), false, true, NOW)).toEqual({ action: 'requeue', reason: 'stuck' });
  });

  it('re-queues failed builds and failed enqueues, but not "not configured"', () => {
    expect(statusRepair(status({ status: 'failed', error: 'build-failed' }), false, true, NOW)).toEqual({ action: 'requeue', reason: 'failed' });
    expect(statusRepair(status({ status: 'enqueue_failed', error: 'queue-push-failed' }), false, true, NOW)).toEqual({ action: 'requeue', reason: 'failed' });
    expect(statusRepair(status({ status: 'failed', error: 'not-configured' }), false, true, NOW)).toEqual({ action: 'skip' });
  });

  it('leaves complete builds, projects that no longer get context, and tickets out of attempts', () => {
    expect(statusRepair(status({ status: 'complete' }), false, true, NOW)).toEqual({ action: 'skip' });
    expect(statusRepair(status({ status: 'failed' }), false, false, NOW)).toEqual({ action: 'skip' });
    expect(statusRepair(status({ status: 'failed', attempt: MAX_REPAIR_ATTEMPTS }), false, true, NOW)).toEqual({ action: 'skip' });
    expect(statusRepair(status({ status: 'failed', attempt: MAX_REPAIR_ATTEMPTS - 1 }), false, true, NOW)).toEqual({ action: 'requeue', reason: 'failed' });
  });
});

describe('attempts', () => {
  it('counts from 1, and a status from a ticket event has none', () => {
    expect(nextAttempt(undefined)).toBe(1);
    expect(nextAttempt(status({}))).toBe(1);
    expect(nextAttempt(status({ attempt: 2 }))).toBe(3);
    expect(canRepair(undefined)).toBe(true);
    expect(canRepair(status({ attempt: MAX_REPAIR_ATTEMPTS }))).toBe(false);
  });
});

describe('bundleIsStale', () => {
  it('is stale when the ticket changed and no build is running', () => {
    expect(bundleIsStale('old', 'new', status({ status: 'complete' }))).toBe(true);
    expect(bundleIsStale('old', 'new', undefined)).toBe(true);
  });

  it('is not stale when the fingerprint matches, a build is in flight, or repairs ran out', () => {
    expect(bundleIsStale('same', 'same', status({}))).toBe(false);
    expect(bundleIsStale('old', 'new', status({ status: 'building' }))).toBe(false);
    expect(bundleIsStale('old', 'new', status({ attempt: MAX_REPAIR_ATTEMPTS }))).toBe(false);
  });
});
