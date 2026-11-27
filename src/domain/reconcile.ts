// Reconciliation decisions (spec §8.7), pure. Found in review: the hourly reindex trigger that owned
// reconciliation was cut with the Confluence index, so nothing repaired a build that died without reaching its
// error handler (a timeout or a platform kill). The pipeline (pipeline/reconcile.ts) reads the records and acts;
// these functions only decide.
//
// Three repairs, all by queueing a normal build, which takes over the status exactly as a ticket edit does:
// - stuck: queued, building or superseded for longer than STUCK_AFTER_MINUTES with no live lock. The build
//   function's limit is 10 minutes and the lock lease 11, so a live build always holds its lock.
// - failed: a build that failed, or a job that could not be queued. Not "not-configured": settings decide that,
//   and a retry cannot change it.
// - stale: a complete bundle whose ticket has changed since it was built (its event never reached Outrider).
// Every repair counts as an attempt. A ticket event starts a fresh build with no attempt count, so the cap only
// stops repairs that keep failing, not normal rebuilds.
import { BuildStatus } from './types';

export const STUCK_AFTER_MINUTES = 15;
export const MAX_REPAIR_ATTEMPTS = 3;

export type StatusRepair = { action: 'requeue'; reason: 'stuck' | 'failed' } | { action: 'skip' };

const SKIP: StatusRepair = { action: 'skip' };
const IN_FLIGHT: BuildStatus['status'][] = ['queued', 'building', 'superseded'];

/** The attempt number the next repair build records. */
export const nextAttempt = (status: Pick<BuildStatus, 'attempt'> | undefined): number => (status?.attempt ?? 0) + 1;

/** True while repairs may still be tried for this status. */
export const canRepair = (status: Pick<BuildStatus, 'attempt'> | undefined): boolean => (status?.attempt ?? 0) < MAX_REPAIR_ATTEMPTS;

/**
 * What to do with one build status. `lockLive` is whether the ticket's lock is held and unexpired now;
 * `contextProject` is whether the ticket's project still gets context.
 */
export function statusRepair(status: BuildStatus, lockLive: boolean, contextProject: boolean, now: Date): StatusRepair {
  if (!contextProject || !canRepair(status)) return SKIP;
  if (IN_FLIGHT.includes(status.status)) {
    const requested = Date.parse(status.requestedAt);
    const stuck = Number.isNaN(requested) || now.getTime() - requested >= STUCK_AFTER_MINUTES * 60_000;
    return stuck && !lockLive ? { action: 'requeue', reason: 'stuck' } : SKIP;
  }
  if (status.status === 'enqueue_failed') return { action: 'requeue', reason: 'failed' };
  if (status.status === 'failed' && status.error !== 'not-configured') return { action: 'requeue', reason: 'failed' };
  return SKIP;
}

/**
 * True when a complete bundle no longer matches its ticket. A bundle whose build is still in flight is left to
 * that build (or to the stuck check), so a repair never races a running build.
 */
export function bundleIsStale(bundleFingerprint: string, currentFingerprint: string, status: BuildStatus | undefined): boolean {
  if (status && IN_FLIGHT.includes(status.status)) return false;
  return bundleFingerprint !== currentFingerprint && canRepair(status);
}
