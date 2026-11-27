// Reconciliation run (spec §8.7), queued hourly by the reconcile sweep and run by the queue consumer, so it has
// the consumer's 10-minute limit. Decisions are in domain/reconcile.ts; this file reads records and acts.
//
// 1. Build statuses, a page at a time: stuck and failed builds are queued again.
// 2. Bundles, a batch at a time: each ticket is fetched in one JQL search as the app and its fingerprint compared
//    with the bundle's. A changed ticket is rebuilt. A ticket Jira says does not exist (404) has its bundle and
//    status deleted.
// 3. Where each pass stopped is saved, so the next run continues there; at the end of the records it starts again.
// Locks need no repair: each carries its own expiry and the next build takes an expired lock over (adapters/storage.ts).
// A run never writes to Jira, and only queues builds of tickets in projects that get context.
import { randomUUID } from 'crypto';
import { getSettings } from '../adapters/settings';
import {
  acquireLock,
  deleteTicketRecords,
  getLock,
  getReconcileCheckpoint,
  getStatus,
  listBundlePage,
  listStatusPage,
  putReconcileCheckpoint,
  releaseLock,
} from '../adapters/storage';
import { currentTickets, ticketExists } from '../adapters/jira';
import { ticketFingerprint } from '../domain/extract';
import { bundleIsStale, nextAttempt, statusRepair } from '../domain/reconcile';
import { isBundleTicket } from '../domain/settings';
import { BuildJob } from '../domain/types';
import { enqueueTicketBuild } from './enqueue';

export const STATUS_PAGE_SIZE = 100;
export const STATUS_PAGES_PER_RUN = 10;
export const BUNDLE_BATCH_SIZE = 50;
export const BUNDLE_BATCHES_PER_RUN = 4;
// Well inside the consumer's 10 minutes; the run stops between pages once this is used up.
export const RECONCILE_TIME_BUDGET_MS = 4 * 60_000;
// One run at a time; a duplicate delivery of the same job skips itself.
export const RECONCILE_LOCK = 'reconcile';

export type ReconcileCounts = {
  statusesChecked: number;
  stuck: number;
  failed: number;
  bundlesChecked: number;
  stale: number;
  deleted: number;
  skipped?: 'not-set-up' | 'locked';
};

const RECONCILE_ACTOR = { source: 'reconcile' as const };

export async function runReconcile(job: Extract<BuildJob, { kind: 'reconcile' }>, now: Date = new Date(), clock: () => number = Date.now): Promise<ReconcileCounts> {
  const counts: ReconcileCounts = { statusesChecked: 0, stuck: 0, failed: 0, bundlesChecked: 0, stale: 0, deleted: 0 };
  const settings = await getSettings();
  if (!settings) return { ...counts, skipped: 'not-set-up' };
  const ownerToken = randomUUID();
  if (!(await acquireLock(RECONCILE_LOCK, job.buildId, ownerToken, now))) {
    console.log('reconcile skipped: another run holds the lock');
    return { ...counts, skipped: 'locked' };
  }
  const started = clock();
  const inBudget = () => clock() - started < RECONCILE_TIME_BUDGET_MS;
  try {
    const checkpoint = await getReconcileCheckpoint();

    // 1. Stuck and failed builds.
    let statusCursor = checkpoint.statusCursor;
    for (let p = 0; p < STATUS_PAGES_PER_RUN && inBudget(); p++) {
      const page = await listStatusPage(STATUS_PAGE_SIZE, statusCursor);
      for (const status of page.values) {
        counts.statusesChecked++;
        const lock = await getLock(status.ticketKey);
        const lockLive = !!lock && Date.parse(lock.expiresAt) > now.getTime();
        const repair = statusRepair(status, lockLive, isBundleTicket(settings, status.ticketKey), now);
        if (repair.action === 'requeue') {
          await enqueueTicketBuild(status.ticketKey, RECONCILE_ACTOR, nextAttempt(status));
          counts[repair.reason]++;
        }
      }
      statusCursor = page.nextCursor;
      if (!statusCursor) break;
    }

    // 2. Stale and orphaned bundles.
    let bundleCursor = checkpoint.bundleCursor;
    for (let b = 0; b < BUNDLE_BATCHES_PER_RUN && inBudget(); b++) {
      const batch = await listBundlePage(BUNDLE_BATCH_SIZE, bundleCursor);
      const inContext = batch.values.filter((v) => isBundleTicket(settings, v.ticketKey));
      const tickets = inContext.length > 0 ? await currentTickets(inContext.map((v) => v.ticketKey), settings) : new Map();
      for (const bundle of inContext) {
        counts.bundlesChecked++;
        const ticket = tickets.get(bundle.ticketKey);
        if (!ticket) {
          // Not returned: deleted, moved or not visible to the app. Only a 404 counts as deleted.
          if (!(await ticketExists(bundle.ticketKey))) {
            await deleteTicketRecords(bundle.ticketKey);
            counts.deleted++;
          }
          continue;
        }
        const status = await getStatus(bundle.ticketKey);
        if (bundleIsStale(bundle.ticketFingerprint, ticketFingerprint(ticket), status)) {
          await enqueueTicketBuild(bundle.ticketKey, RECONCILE_ACTOR, nextAttempt(status));
          counts.stale++;
        }
      }
      bundleCursor = batch.nextCursor;
      if (!bundleCursor) break;
    }

    await putReconcileCheckpoint({ statusCursor, bundleCursor });
    console.log(
      `reconcile: ${counts.statusesChecked} status(es) checked, re-queued ${counts.stuck} stuck and ${counts.failed} failed; ` +
        `${counts.bundlesChecked} bundle(s) checked, ${counts.stale} stale rebuilt, ${counts.deleted} deleted`,
    );
    return counts;
  } finally {
    await releaseLock(RECONCILE_LOCK, ownerToken).catch((err) => console.error('reconcile lock release failed', err));
  }
}
