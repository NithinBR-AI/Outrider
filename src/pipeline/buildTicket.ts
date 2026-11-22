// Ticket context builder (spec §4.1, §8).
//
// 1. Skip if a newer build owns the status, or this build already finished (duplicate delivery).
// 2. Acquire the per-ticket lock (§8.5). If another build holds it, re-queue this job after a delay.
// 3. Fetch the ticket, retrieve incidents, resolutions and articles concurrently with failure isolation,
//    re-rank them with embeddings when available (step 12; keyword ranking otherwise) and apply the
//    stored-candidate limit. Then generate the summary claims
//    (adapters/mantle.ts), or reuse the previous ones if the prompt is unchanged. Failure: no summary.
// 4. Re-fetch the ticket. If its fingerprint changed, the result is stale: discard it, mark the build
//    superseded and queue a fresh build (§8.4).
// 5. Write guards (§8.6): write only if this build still holds the lock and still owns the status.
// 6. Always release the lock if this build still owns it.
//
// All of this is best-effort, not strict mutual exclusion (§8.5, §8.6, §18.9). Read-time
// authorization (§16) is step 6c-2.
import { randomUUID } from 'crypto';
import { Article, BuildJob, ContextBundle, Incident, PersistedSummary, Resolution, Ticket } from '../domain/types';
import { ticketFingerprint } from '../domain/extract';
import { limitCandidates } from '../domain/score';
import { buildGenerationPrompt, promptHash } from '../domain/generate';
import * as jira from '../adapters/jira';
import * as confluence from '../adapters/confluence';
import { generateClaims } from '../adapters/mantle';
import { embedTicketAndCandidates } from '../adapters/jina';
import { candidateEmbeddingTexts, rerankWithEmbeddings, Sections, similarities, ticketEmbeddingText } from '../domain/embeddings';
import { getSettings } from '../adapters/settings';
import { isBundleTicket } from '../domain/settings';
import { acquireLock, getBundle, getStatus, holdsLock, putBundle, releaseLock, updateStatusIf } from '../adapters/storage';
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

/**
 * Generated claims for the bundle (spec §12.6, §13.6), stored unverified; every read verifies them for
 * that viewer. Returns undefined, so the bundle has no summary, when there are no sources, when the model
 * returns no claims, or on any generation failure (§13.3). A failure is logged as a short code only and
 * does not mark the bundle partial: partial and failures describe sources.
 * If the previous bundle's live summary came from an identical prompt, its claims are reused without a call.
 */
async function summarize(ticket: Ticket, incidents: Incident[], resolutions: Resolution[], articles: Article[]): Promise<PersistedSummary | undefined> {
  const prompt = buildGenerationPrompt(ticket, incidents, resolutions, articles);
  if (!prompt) return undefined;
  const hash = promptHash(prompt);
  const previous = await getBundle(ticket.key).catch(() => undefined);
  if (previous?.summary?.origin === 'llm' && previous.summary.promptHash === hash) {
    console.log(`summary for ${ticket.key} reused: prompt unchanged`);
    return previous.summary;
  }
  try {
    const started = Date.now();
    const result = await generateClaims(prompt);
    console.log(`summary for ${ticket.key}: ${result.claims.length} claims from ${result.model} in ${Date.now() - started} ms (tokens ${result.usage?.prompt_tokens ?? '?'} in / ${result.usage?.completion_tokens ?? '?'} out)`);
    if (result.claims.length === 0) return undefined;
    return { origin: 'llm', promptHash: hash, generatedClaims: result.claims };
  } catch (err) {
    console.warn(`summary for ${ticket.key} not generated: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Re-ranks the keyword-chosen candidates with embedding similarity (step 12, domain/embeddings.ts). On any
 * failure, or with no candidates, the keyword ranking is kept. Per spec §12.5 a failure is logged only: it
 * does not mark the bundle partial and is not shown in the panel or MCP.
 */
async function withEmbeddings(ticket: Ticket, sections: Sections, now: Date): Promise<Sections> {
  const candidates = candidateEmbeddingTexts(sections);
  if (candidates.length === 0) return sections;
  try {
    const started = Date.now();
    const result = await embedTicketAndCandidates(ticketEmbeddingText(ticket), candidates.map((c) => c.text));
    const sims = similarities(result.ticket, candidates.map((c, i) => ({ key: c.key, vector: result.candidates[i] })));
    const reranked = rerankWithEmbeddings(sections, sims, now);
    console.log(`embeddings for ${ticket.key}: ${candidates.length} candidate(s), ${result.tokens} tokens, ${Date.now() - started} ms, below the floor: ${reranked.droppedArticles} article(s), ${reranked.droppedIncidents} incident(s)`);
    return reranked;
  } catch (err) {
    console.warn(`embeddings for ${ticket.key} not used (${(err as Error).message}): keyword ranking kept`);
    return sections;
  }
}

async function runBuild(job: TicketJob, ownerToken: string): Promise<void> {
  const { ticketKey, buildId } = job;

  // Settings are read once per invocation. If the site was unconfigured, or this project removed, after the
  // job was queued, build nothing.
  const settings = await getSettings();
  if (!settings || !isBundleTicket(settings, ticketKey)) {
    await updateStatusIf(ticketKey, buildId, ['building'], { status: 'failed', error: 'not-configured' });
    console.log(`build ${buildId} for ${ticketKey} skipped: project not configured`);
    return;
  }

  const ticket = await jira.getTicket(ticketKey, settings);
  const fingerprint = ticketFingerprint(ticket);
  const now = new Date();
  const failures: string[] = [];
  const [incidents, resolutions, articles] = await Promise.all([
    safe(() => jira.searchIncidents(ticket, settings, now), [], failures, 'jira-incidents'),
    safe(() => jira.searchResolutions(ticket, settings, now), [], failures, 'jira-resolutions'),
    (settings.confluenceSpaces ?? []).length > 0 ? safe(() => confluence.searchArticles(ticket, settings, now), [], failures, 'confluence-articles') : Promise.resolve([]),
  ]);

  // An incident that also appears as a past resolution is shown once, as the resolution.
  const resolutionKeys = new Set(resolutions.map((r) => r.source.id));
  const dedupedIncidents = incidents.filter((i) => !resolutionKeys.has(i.source.id));
  const ranked = await withEmbeddings(ticket, { incidents: dedupedIncidents, resolutions, articles }, now);
  const [keptIncidents, keptResolutions, keptArticles] = limitCandidates([ranked.incidents, ranked.resolutions, ranked.articles]);

  // Before the stale check, so a ticket edited while the model runs still discards this result.
  const summary = await summarize(ticket, keptIncidents, keptResolutions, keptArticles);

  // Stale-build protection (§8.4): the ticket must be unchanged since retrieval started.
  const latestTicket = await jira.getTicket(ticketKey, settings);
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
    articles: keptArticles,
    services: [], // Unused: step 11 teams are looked up at read time (resolvers/viewerContext.ts) and never stored.
    partial: failures.length > 0,
    failures,
  };
  if (summary) bundle.summary = summary;
  await putBundle(bundle);
  await updateStatusIf(ticketKey, buildId, ['building'], { status: 'complete' });
  console.log(`built ${ticketKey}: ${keptIncidents.length} incidents, ${keptResolutions.length} resolutions, failures=[${failures.join(',')}]`);
}
