// Emerging-incident signals for the current viewer (step 13, spec §14.9). Shared by the panel (viewerContext.ts)
// and the get-emerging-incidents MCP tool, so both apply exactly the same rules (§15.5).
//
// - Stored records hold the unfiltered request set. Every read checks the requests AS THE VIEWER with one JQL
//   search, and a signal is returned only if at least its threshold of requests stays visible.
// - A failed check returns no signals and the failure code; never an unfiltered signal (§16.5).
// - A failure to list records (storage unavailable) also returns no signals; signals are advisory and never
//   block the rest of the panel.
import { visibleIssueKeys } from '../adapters/jira';
import { listClusterRecords, putClusterRecord } from '../adapters/storage';
import { ClusterRecord, ClusterSignal, dismissRecord, isActiveRecord, signalForViewer } from '../domain/cluster';

export const CLUSTER_CHECK_FAILED = 'auth:cluster-check-failed';

export type SignalsResult = { signals: ClusterSignal[]; failure?: string };

/** Active records of the given projects, optionally only those containing a ticket. Empty on storage failure. */
async function activeRecords(projectKeys: string[], ticketKey?: string): Promise<ClusterRecord[]> {
  const out: ClusterRecord[] = [];
  for (const projectKey of projectKeys) {
    try {
      for (const r of await listClusterRecords(projectKey)) {
        if (isActiveRecord(r) && (!ticketKey || r.requestKeys.includes(ticketKey))) out.push(r);
      }
    } catch (err) {
      console.warn(`signals: cluster records for ${projectKey} could not be listed: ${(err as Error).message}`);
    }
  }
  return out;
}

/** Filters records for the current viewer with one visibility check. Most recently raised first. */
async function forViewer(records: ClusterRecord[]): Promise<SignalsResult> {
  if (records.length === 0) return { signals: [] };
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
  return { signals };
}

/** Signals that include this ticket, as the current viewer may see them. */
export async function signalsForTicket(ticketKey: string): Promise<SignalsResult> {
  return forViewer(await activeRecords([ticketKey.split('-')[0]], ticketKey));
}

/**
 * Dismisses a signal from a ticket's panel (§14.7 resolved by a human). Only a viewer who can see the ticket and
 * enough of the signal's requests to be shown it may dismiss it; anything else is refused without saying why,
 * so no one learns about a signal they cannot see. It changes only Outrider's record, never anything in Jira.
 */
export async function dismissSignal(ticketKey: string, signalId: string, now: Date = new Date()): Promise<{ ok: boolean }> {
  try {
    if (!(await visibleIssueKeys([ticketKey])).has(ticketKey)) return { ok: false };
    const rec = (await activeRecords([ticketKey.split('-')[0]], ticketKey)).find((r) => r.signalId === signalId);
    if (!rec || !signalForViewer(rec, await visibleIssueKeys(rec.requestKeys))) return { ok: false };
    await putClusterRecord(dismissRecord(rec, now));
    console.log(`signal ${signalId} dismissed from ${ticketKey}`);
    return { ok: true };
  } catch (err) {
    console.error(`signal ${signalId} could not be dismissed from ${ticketKey}`, err);
    return { ok: false };
  }
}

/** Every active signal in these projects, as the current viewer may see them. */
export async function signalsForProjects(projectKeys: string[]): Promise<SignalsResult> {
  return forViewer(await activeRecords(projectKeys));
}
