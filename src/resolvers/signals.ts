// Emerging-incident signals for the current viewer (step 13, spec §14.9). Shared by the panel (viewerContext.ts)
// and the get-emerging-incidents MCP tool, so both apply exactly the same rules (§15.5).
//
// - Stored records hold the unfiltered request set. Every read checks the requests AS THE VIEWER with one JQL
//   search, and a signal is returned only if at least its threshold of requests stays visible.
// - A failed check returns no signals and the failure code; never an unfiltered signal (§16.5).
// - A project whose records cannot be listed (storage unavailable) is reported as CLUSTER_RECORDS_UNAVAILABLE, so
//   a failed read is never presented as "no signals". Found in review: it used to be skipped silently, and the
//   no-signals note then told agents Outrider had found no group. Signals stay advisory and never block the panel.
import { randomUUID } from 'crypto';
import { visibleIssueKeys } from '../adapters/jira';
import { acquireLock, listClusterRecords, putClusterRecord, releaseLock } from '../adapters/storage';
import { ClusterRecord, ClusterSignal, clusterLockKey, dismissRecord, isActiveRecord, signalForViewer } from '../domain/cluster';

export const CLUSTER_CHECK_FAILED = 'auth:cluster-check-failed';
export const CLUSTER_RECORDS_UNAVAILABLE = 'cluster-records-unavailable';

export type SignalsResult = { signals: ClusterSignal[]; failure?: string };

/** Active records of the given projects, optionally only those containing a ticket, and whether any project failed. */
async function activeRecords(projectKeys: string[], ticketKey?: string): Promise<{ records: ClusterRecord[]; failed: boolean }> {
  const records: ClusterRecord[] = [];
  let failed = false;
  for (const projectKey of projectKeys) {
    try {
      for (const r of await listClusterRecords(projectKey)) {
        if (isActiveRecord(r) && (!ticketKey || r.requestKeys.includes(ticketKey))) records.push(r);
      }
    } catch (err) {
      failed = true;
      console.warn(`signals: cluster records for ${projectKey} could not be listed: ${(err as Error).message}`);
    }
  }
  return { records, failed };
}

/**
 * Filters records for the current viewer with one visibility check. Most recently raised first. A failed check
 * wins over a storage failure: it returns no signals at all, while a storage failure keeps the projects that answered.
 */
async function forViewer({ records, failed }: { records: ClusterRecord[]; failed: boolean }): Promise<SignalsResult> {
  const storageFailure = failed ? { failure: CLUSTER_RECORDS_UNAVAILABLE } : {};
  if (records.length === 0) return { signals: [], ...storageFailure };
  let visible: Set<string>;
  try {
    visible = await visibleIssueKeys([...new Set(records.flatMap((r) => r.requestKeys))]);
  } catch (err) {
    console.error('signals: viewer visibility check failed', err);
    return { signals: [], failure: CLUSTER_CHECK_FAILED };
  }
  const signals = records
    .map((r) => signalForViewer(r, visible))
    .filter((s): s is ClusterSignal => !!s)
    .sort((a, b) => (a.raisedAt < b.raisedAt ? 1 : a.raisedAt > b.raisedAt ? -1 : 0));
  return { signals, ...storageFailure };
}
/** Signals that include this ticket, as the current viewer may see them. */
export async function signalsForTicket(ticketKey: string): Promise<SignalsResult> {
  return forViewer(await activeRecords([ticketKey.split('-')[0]], ticketKey));
}

// Dismiss takes the project's clustering lock, so a pass that read the record before the dismissal cannot write
// the active version back over it (found in review). A pass holds the lock for a few seconds; Dismiss waits for it.
export const DISMISS_LOCK_ATTEMPTS = 5;
export const DISMISS_LOCK_WAIT_MS = 1000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dismisses a signal from a ticket's panel (§14.7 resolved by a human). Only a viewer who can see the ticket and
 * enough of the signal's requests to be shown it may dismiss it; anything else is refused without saying why,
 * so no one learns about a signal they cannot see. It changes only Outrider's record, never anything in Jira.
 * The record is read again under the lock, so the dismissal applies to its latest version.
 */
export async function dismissSignal(ticketKey: string, signalId: string, now: Date = new Date(), lockWaitMs = DISMISS_LOCK_WAIT_MS): Promise<{ ok: boolean }> {
  const projectKey = ticketKey.split('-')[0];
  const ownerToken = randomUUID();
  let locked = false;
  try {
    if (!(await visibleIssueKeys([ticketKey])).has(ticketKey)) return { ok: false };
    for (let attempt = 1; attempt <= DISMISS_LOCK_ATTEMPTS && !locked; attempt++) {
      locked = !!(await acquireLock(clusterLockKey(projectKey), `dismiss-${signalId}`, ownerToken, new Date()));
      if (!locked && attempt < DISMISS_LOCK_ATTEMPTS) await wait(lockWaitMs);
    }
    if (!locked) {
      console.warn(`signal ${signalId} not dismissed from ${ticketKey}: a clustering pass held the lock`);
      return { ok: false };
    }
    const rec = (await activeRecords([projectKey], ticketKey)).records.find((r) => r.signalId === signalId);
    if (!rec || !signalForViewer(rec, await visibleIssueKeys(rec.requestKeys))) return { ok: false };
    await putClusterRecord(dismissRecord(rec, now));
    console.log(`signal ${signalId} dismissed from ${ticketKey}`);
    return { ok: true };
  } catch (err) {
    console.error(`signal ${signalId} could not be dismissed from ${ticketKey}`, err);
    return { ok: false };
  } finally {
    if (locked) await releaseLock(clusterLockKey(projectKey), ownerToken).catch((err) => console.error(`dismiss lock release failed for ${projectKey}`, err));
  }
}
/** Every active signal in these projects, as the current viewer may see them. */
export async function signalsForProjects(projectKeys: string[]): Promise<SignalsResult> {
  return forViewer(await activeRecords(projectKeys));
}
