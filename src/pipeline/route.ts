// Job routing (spec §6.4). The BuildJob discriminated union guarantees a Confluence page job
// can never reach Jira ticket retrieval.
import { BuildJob } from '../domain/types';
import { buildTicketBundle } from './buildTicket';
import { runClusterPass } from './clusterPass';

/** Runtime check for a queue body. The queue is typed, but a consumer must not trust its input. */
export function isBuildJob(value: unknown): value is BuildJob {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const common = typeof v.buildId === 'string' && typeof v.requestedAt === 'string' && !!v.actor && typeof v.actor === 'object';
  if (!common) return false;
  if (v.kind === 'jira-ticket') return typeof v.ticketKey === 'string';
  if (v.kind === 'confluence-page') return typeof v.contentId === 'string' && (v.operation === 'upsert' || v.operation === 'delete');
  if (v.kind === 'cluster-pass') return typeof v.projectKey === 'string';
  return false;
}

export async function handleJob(job: BuildJob): Promise<void> {
  switch (job.kind) {
    case 'jira-ticket':
      return buildTicketBundle(job);

    case 'cluster-pass':
      return runClusterPass(job);
    case 'confluence-page':
      // Confluence indexing is step 10. No Confluence events are subscribed yet, so this
      // branch is unreachable today; it exists because the job union already includes it.
      console.warn(`confluence-page job ${job.buildId} received before Confluence indexing exists, skipped`);
      return;

    default: {
      const exhaustive: never = job;
      return exhaustive;
    }
  }
}
