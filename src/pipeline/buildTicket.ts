// Ticket context builder (spec §4.1, §8).
//
// 1. Skip if a newer build owns the status, or this build already finished (duplicate delivery).
// 2. Acquire the per-ticket lock (§8.5). If another build holds it, re-queue this job after a delay.
// 3. Fetch the ticket, retrieve incidents and resolutions concurrently with failure isolation,
//    rank them (domain/score.ts) and apply the stored-candidate limit.
// 4. Re-fetch the ticket. If its fingerprint changed, the result is stale: discard it, mark the build
//    superseded and queue a fresh build (§8.4).
// 5. Write guards (§8.6): write only if this build still holds the lock and still owns the status.
// 6. Always release the lock if this build still owns it.
//
// All of this is best-effort, not strict mutual exclusion (§8.5, §8.6, §18.9). Read-time
// authorization (§16) is step 6c-2.
import { randomUUID } from 'crypto';
import { BuildJob, ContextBundle } from '../domain/types';
import { ticketFingerprint } from '../domain/extract';
import { limitCandidates } from '../domain/score';
import { demoSummaryFor } from '../domain/demoSummary';
import * as jira from '../adapters/jira';
import { acquireLock, getStatus, holdsLock, putBundle, releaseLock, updateStatusIf } from '../adapters/storage';
import { enqueueTicketBuild, requeueTicketJob } from './enqueue';

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

  // Per-ticket serialization. A unique token per attempt, so two copies of the same build differ.
  const ownerToken = randomUUID();
  const lock = await acquireLock(ticketKey, buildId, ownerToken);
  if (!lock) {
    await requeueTicketJob(job);
    console.log(`build ${buildId} for ${ticketKey} deferred: another build holds the ticket lock`);
    return;
  }

  try {
    await updateStatusIf(ticketKey, buildId, ['queued', 'building'], { status: 'building' });
    await runBuild(job, ownerToken);
  } catch (err) {
    console.error(`build ${buildId} for ${ticketKey} failed`, err);
    await updateStatusIf(ticketKey, buildId, ['building'], { status: 'failed', error: 'build-failed' });
  } finally {
    await releaseLock(ticketKey, ownerToken).catch((err) => console.error(`lock release failed for ${ticketKey}`, err));
  }
}

async function runBuild(job: TicketJob, ownerToken: string): Promise<void> {
  const { ticketKey, buildId } = job;

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
    // Queue a fresh build only if this build still owns the status. If a newer build already owns
    // it (the ticket edit that changed the fingerprint also fired an event), that build covers it.
    if (await updateStatusIf(ticketKey, buildId, ['building'], { status: 'superseded' })) {
      const next = await enqueueTicketBuild(ticketKey, job.actor);
      console.log(`build ${buildId} for ${ticketKey} superseded: ticket changed during the build, queued ${next.buildId}`);
    } else {
      console.log(`build ${buildId} for ${ticketKey} superseded: ticket changed and a newer build already owns the status`);
    }
    return;
  }

  // Write guards (§8.6): this build must still hold the lock and still own the status.
  if (!(await holdsLock(ticketKey, ownerToken))) {
    console.log(`build ${buildId} for ${ticketKey} lost the ticket lock before writing, result discarded`);
    return;
  }
  const latest = await getStatus(ticketKey);
  if (latest && latest.buildId !== buildId) {
    console.log(`build ${buildId} for ${ticketKey} finished after newer build ${latest.buildId}, result discarded`);
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
  // Generated claims. Until LLM generation exists (step 8c), only the demo ticket has a canned summary
  // (spec §13.6). Claims are stored unverified; every read verifies them for that viewer.
  const summary = demoSummaryFor(ticketKey);
  if (summary) bundle.summary = summary;
  await putBundle(bundle);
  await updateStatusIf(ticketKey, buildId, ['building'], { status: 'complete' });
  console.log(`built ${ticketKey}: ${keptIncidents.length} incidents, ${keptResolutions.length} resolutions, failures=[${failures.join(',')}]`);
}
