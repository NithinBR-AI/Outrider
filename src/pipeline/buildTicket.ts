// Ticket context builder (spec §4.1, §8).
//
// Step 6a scope: fetch the ticket, retrieve incidents and resolutions concurrently with
// failure isolation, and store the bundle. Not yet included (later steps):
//   - 6b: deterministic ranking (§9), fingerprint and stale-build supersession (§8.2, §8.4)
//   - 6c: per-ticket lock and write guards (§8.5, §8.6), read-time authorization (§16)
import { BuildJob, ContextBundle } from '../domain/types';
import * as jira from '../adapters/jira';
import { getStatus, putBundle, updateStatusIf } from '../adapters/storage';

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
  if (current && current.status === 'complete') {
    console.log(`build ${buildId} for ${ticketKey} already complete, duplicate delivery ignored`);
    return;
  }
  await updateStatusIf(ticketKey, buildId, ['queued', 'building'], { status: 'building' });

  try {
    const ticket = await jira.getTicket(ticketKey);
    const failures: string[] = [];
    const [incidents, resolutions] = await Promise.all([
      safe(() => jira.searchIncidents(ticket), [], failures, 'jira-incidents'),
      safe(() => jira.searchResolutions(ticket), [], failures, 'jira-resolutions'),
    ]);

    // An incident that also appears as a past resolution is shown once, as the resolution.
    const resolutionKeys = new Set(resolutions.map((r) => r.source.id));
    const dedupedIncidents = incidents.filter((i) => !resolutionKeys.has(i.source.id));

    const bundle: ContextBundle = {
      ticketKey,
      builtAt: new Date().toISOString(),
      buildId,
      ticketFingerprint: '', // Step 6b. An empty fingerprint is treated as stale by reconciliation (§8.7).
      incidents: dedupedIncidents,
      resolutions,
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
    console.log(`built ${ticketKey}: ${dedupedIncidents.length} incidents, ${resolutions.length} resolutions, failures=[${failures.join(',')}]`);
  } catch (err) {
    console.error(`build ${buildId} for ${ticketKey} failed`, err);
    await updateStatusIf(ticketKey, buildId, ['building'], { status: 'failed', error: 'build-failed' });
  }
}
