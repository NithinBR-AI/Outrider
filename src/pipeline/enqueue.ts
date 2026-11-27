// Jira event handler and queue producer (spec §6.2, §6.3).
// The handler only records a queued status and pushes a job. It never calls Jira,
// Confluence, Teamwork Graph or an LLM, so it returns quickly.
import { randomUUID } from 'crypto';
import { Queue } from '@forge/events';
import { ActorContext, BuildJob } from '../domain/types';
import { putStatus, updateStatusIf } from '../adapters/storage';
import { getSettings } from '../adapters/settings';
import { isBundleTicket } from '../domain/settings';

// Must match consumer.queue in manifest.yml.
export const BUILD_QUEUE_KEY = 'outrider-build-queue';

// Which projects' tickets get a context bundle is a site setting (domain/settings.ts, set on the admin
// page). With no settings saved, no event queues a build.

const queue = new Queue<BuildJob>({ key: BUILD_QUEUE_KEY });

// The fields of avi:jira:created:issue / avi:jira:updated:issue that we read.
// Ticket text in the payload is ignored on purpose (spec §8.1).
type JiraIssueEvent = {
  eventType?: string;
  selfGenerated?: boolean;
  atlassianId?: string;
  issue?: { key?: string };
};

// Delay before retrying a build that found the ticket locked by another build (agreed in 6c planning).
export const LOCK_RETRY_DELAY_SECONDS = 30;

/**
 * Pushes the same job again after a delay, without creating a new build or touching its status.
 * Used when another build holds the ticket lock. If a newer build has taken over the status by the
 * time the retry runs, the retry skips itself, so retries end naturally.
 */
export async function requeueTicketJob(job: Extract<BuildJob, { kind: 'jira-ticket' }>, delaySeconds = LOCK_RETRY_DELAY_SECONDS): Promise<void> {
  await queue.push({ body: job, delayInSeconds: delaySeconds });
}

/** Records a queued status for a new build and pushes the job. Shared by events and future callers. */
export async function enqueueTicketBuild(ticketKey: string, actor: ActorContext, attempt?: number): Promise<{ buildId: string; requestedAt: string }> {
  const buildId = randomUUID();
  const requestedAt = new Date().toISOString();
  await putStatus({ ticketKey, buildId, requestedAt, status: 'queued', actor, ...(attempt !== undefined ? { attempt } : {}) });
  try {
    await queue.push({ body: { kind: 'jira-ticket', ticketKey, buildId, requestedAt, actor } });
  } catch (err) {
    // Only mark enqueue_failed if this build still owns the status and it is still queued (spec §6.2).
    await updateStatusIf(ticketKey, buildId, ['queued'], { status: 'enqueue_failed', error: 'queue-push-failed' });
    console.error(`enqueue failed for ${ticketKey} build ${buildId}`, err);
    throw err;
  }
  return { buildId, requestedAt };
}

// ---- Clustering passes (step 13) ----

// A pass waits this long after a ticket event, so several requests created together are seen in one pass.
export const CLUSTER_PASS_DELAY_SECONDS = 20;

/** Queues one clustering pass for a project. Passes are idempotent; the per-project lock serializes them. */
export async function enqueueClusterPass(projectKey: string, actor: ActorContext, delaySeconds = CLUSTER_PASS_DELAY_SECONDS): Promise<void> {
  await queue.push({ body: { kind: 'cluster-pass', projectKey, buildId: randomUUID(), requestedAt: new Date().toISOString(), actor }, delayInSeconds: delaySeconds });
}

/** Re-queues a pass that found the project locked by another pass. */
export async function requeueClusterJob(job: Extract<BuildJob, { kind: 'cluster-pass' }>, delaySeconds = LOCK_RETRY_DELAY_SECONDS): Promise<void> {
  await queue.push({ body: job, delayInSeconds: delaySeconds });
}

/** Hourly scheduled trigger (manifest: cluster-sweep): one pass per context project, so signals expire on time. */
export async function onClusterSweep(): Promise<void> {
  const settings = await getSettings();
  if (!settings || (!settings.affectedServicesField && !settings.clusterEntityField)) return;
  for (const projectKey of settings.bundleProjects) await enqueueClusterPass(projectKey, { source: 'unknown' }, 0);
  console.log(`cluster sweep queued ${settings.bundleProjects.length} pass(es)`);
}

/** Hourly scheduled trigger (manifest: reconcile-sweep): queues one reconciliation run (pipeline/reconcile.ts). */
export async function onReconcileSweep(): Promise<void> {
  await queue.push({ body: { kind: 'reconcile', buildId: randomUUID(), requestedAt: new Date().toISOString(), actor: { source: 'reconcile' } } });
  console.log('reconcile sweep queued 1 run');
}

export async function onJiraIssueEvent(event: JiraIssueEvent): Promise<void> {
  // Ignore events caused by this app to avoid loops (spec §5.4).
  if (event.selfGenerated) return;

  const ticketKey = event.issue?.key;
  if (!ticketKey) {
    console.warn(`jira event ${event.eventType ?? 'unknown'} without issue key, skipped`);
    return;
  }
  const settings = await getSettings();
  if (!isBundleTicket(settings, ticketKey)) return;

  const actor: ActorContext = { source: 'jira-event' };
  const { buildId } = await enqueueTicketBuild(ticketKey, actor);
  console.log(`queued build ${buildId} for ${ticketKey} (${event.eventType ?? 'unknown event'})`);
  // Step 13: a request was created or changed, so its project's clusters may have changed too. A failure here
  // must not affect the ticket build, which is already queued.
  if (settings && (settings.affectedServicesField || settings.clusterEntityField)) {
    await enqueueClusterPass(ticketKey.split('-')[0], actor).catch((err) => console.error(`cluster pass enqueue failed for ${ticketKey}`, err));
  }
}
