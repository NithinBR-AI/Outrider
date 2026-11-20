// Ticket context builder (spec §4.1, §8).
//
// Fetches the ticket, retrieves incidents and resolutions concurrently with failure isolation,
// ranks them (domain/score.ts), applies the stored-candidate limit, and stores the bundle.
// Before writing, the ticket is re-fetched: if its fingerprint changed during the build, the
// result is stale, so it is discarded, the build is marked superseded and a fresh build is queued.
//
// Not yet included (step 6c): per-ticket lock and write guards (§8.5, §8.6), read-time authorization (§16).
import { BuildJob, ContextBundle } from '../domain/types';
import { ticketFingerprint } from '../domain/extract';
import { limitCandidates } from '../domain/score';
import * as jira from '../adapters/jira';
import { getStatus, putBundle, updateStatusIf } from '../adapters/storage';
import { enqueueTicketBuild } from './enqueue';

type TicketJob = Extract<BuildJob, { kind: 'jira-ticket' }>;

/**
 * Runs one source and returns the fallback if it fails, recording a short failure identifier.
 * One failing source must never block the other sections (spec §8.3). Exception details are
 * logged, never stored in the user-visible failures list.
 */
async function safe<T>(fn: () => Promise<T>, fallback: T, failures: string[], id: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    failures.push(id);
    console.error(`source ${id} failed`, err);
    return fallback;
  }
}

export async function buildTicketBundle(job: TicketJob): Promise<void> {
  const { ticketKey, buildId } = job;

  // Duplicate delivery: if this build already finished or was replaced, do nothing.
  const current = await getStatus(ticketKey);
  if (current && current.buildId !== buildId) {
    console.log(`build ${buildId} for ${ticketKey} skipped, newer build ${current.buildId} owns the status`);
    return;
  }
  if (current && (current.status === 'complete' || current.status === 'superseded')) {
    console.log(`build ${buildId} for ${ticketKey} already ${current.status}, duplicate delivery ignored`);
    return;
  }
  await updateStatusIf(ticketKey, buildId, ['queued', 'building'], { status: 'building' });

  try {
    const ticket = await jira.getTicket(ticketKey);
    const fingerprint = ticketFingerprint(ticket);
    const now = new Date();
    const failures: string[] = [];
    const [incidents, resolutions] = await Promise.all([
      safe(() => jira.searchIncidents(ticket, now), [], failures, 'jira-incidents'),
      safe(() => jira.searchResolutions(ticket, now), [], failures, 'jira-resolutions'),
    ]);

    // An incident that also appears as a past resolution is shown once, as the resolution.
    const resolutionKeys = new Set(resolutions.map((r) => r.source.id));
    const dedupedIncidents = incidents.filter((i) => !resolutionKeys.has(i.source.id));
    const [keptIncidents, keptResolutions] = limitCandidates([dedupedIncidents, resolutions]);

    // Stale-build protection (§8.4): the ticket must be unchanged since retrieval started.
    const latestTicket = await jira.getTicket(ticketKey);
    if (ticketFingerprint(latestTicket) !== fingerprint) {
      await updateStatusIf(ticketKey, buildId, ['building'], { status: 'superseded' });
      const next = await enqueueTicketBuild(ticketKey, job.actor);
      console.log(`build ${buildId} for ${ticketKey} superseded: ticket changed during the build, queued ${next.buildId}`);
      return;
    }

    const bundle: ContextBundle = {
      ticketKey,
      builtAt: now.toISOString(),
      buildId,
      ticketFingerprint: fingerprint,
      incidents: keptIncidents,
      resolutions: keptResolutions,
      articles: [], // Step 10 (Confluence).
      services: [], // Step 11 (Teamwork Graph).
      partial: failures.length > 0,
      failures,
    };

    // Write only if this build still owns the status (best-effort, see storage.updateStatusIf).
    const latest = await getStatus(ticketKey);
    if (latest && latest.buildId !== buildId) {
      console.log(`build ${buildId} for ${ticketKey} finished after newer build ${latest.buildId}, result discarded`);
      return;
    }
    await putBundle(bundle);
    await updateStatusIf(ticketKey, buildId, ['building'], { status: 'complete' });
    console.log(`built ${ticketKey}: ${keptIncidents.length} incidents, ${keptResolutions.length} resolutions, failures=[${failures.join(',')}]`);
  } catch (err) {
    console.error(`build ${buildId} for ${ticketKey} failed`, err);
    await updateStatusIf(ticketKey, buildId, ['building'], { status: 'failed', error: 'build-failed' });
  }
}
