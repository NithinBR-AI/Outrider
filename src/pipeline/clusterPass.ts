// Clustering pass for one project (step 13, spec §4.3, §14). Runs on the build queue: queued after ticket events
// in a context project, and hourly by the scheduled sweep so signals still expire when nothing changes.
//
// 1. Skip unless the project gets context and an identity field is configured.
// 2. Per-project lock (the same best-effort lease as ticket builds); if held, re-queue after a short delay.
// 3. Read the project's open requests created within the window, as the app (adapters/clusterSource.ts).
// 4. Reconcile with the stored records (domain/cluster.ts): raise, update or expire. Idempotent.
// 5. Write the changed records, delete long-ended ones, release the lock.
// It never writes to Jira: a signal recommends investigation and nothing else (§14.10).
import { randomUUID } from 'crypto';
import { reconcileClusters, staleRecords, withDisplayNames } from '../domain/cluster';
import { clusterConfig, SiteSettings } from '../domain/settings';
import { openRequestsForClustering } from '../adapters/clusterSource';
import { getSettings } from '../adapters/settings';
import { acquireLock, deleteClusterRecord, listClusterRecords, putClusterRecord, releaseLock } from '../adapters/storage';
import { requeueClusterJob } from './enqueue';
import { BuildJob } from '../domain/types';

type ClusterJob = Extract<BuildJob, { kind: 'cluster-pass' }>;

// Requests are read from slightly before the window, so a window that started just inside it is complete.
const LOOKBACK_MARGIN_MINUTES = 5;

/** True if clustering can find any identity for this site: a service field or an entity field is set. */
export const clusteringEnabled = (settings: SiteSettings | undefined): settings is SiteSettings =>
  !!settings && (!!settings.affectedServicesField || !!settings.clusterEntityField);

/** Lock key for a project's pass; distinct from every ticket key (which always contains a dash and digits). */
export const clusterLockKey = (projectKey: string) => `cluster-pass_${projectKey}`;

export async function runClusterPass(job: ClusterJob, now: Date = new Date()): Promise<void> {
  const { projectKey } = job;
  const settings = await getSettings();
  if (!clusteringEnabled(settings) || !settings.bundleProjects.includes(projectKey)) {
    console.log(`cluster pass for ${projectKey} skipped: clustering not configured for this project`);
    return;
  }
  const ownerToken = randomUUID();
  if (!(await acquireLock(clusterLockKey(projectKey), job.buildId, ownerToken, now))) {
    await requeueClusterJob(job);
    console.log(`cluster pass for ${projectKey} deferred: another pass holds the lock`);
    return;
  }
  try {
    const config = clusterConfig(settings);
    const source = await openRequestsForClustering(projectKey, settings, config.windowMinutes + LOOKBACK_MARGIN_MINUTES);
    const existing = await listClusterRecords(projectKey);
    const writes = withDisplayNames(reconcileClusters(projectKey, source.requests, existing, config, now, randomUUID), source.serviceNames, source.entityNames);
    for (const w of writes) await putClusterRecord(w);
    const stale = staleRecords(existing, now).filter((s) => !writes.some((w) => w.storageKey === s.storageKey));
    for (const s of stale) await deleteClusterRecord(s.storageKey);
    const counts = writes.reduce<Record<string, number>>((acc, w) => ({ ...acc, [w.lifecycle]: (acc[w.lifecycle] ?? 0) + 1 }), {});
    console.log(
      `cluster pass for ${projectKey}: ${source.requests.length} open request(s), window ${config.windowMinutes} min, threshold ${config.threshold}; ` +
        `raised ${counts.raised ?? 0}, updated ${counts.updated ?? 0}, expired ${counts.expired ?? 0}, deleted ${stale.length}`,
    );
  } finally {
    await releaseLock(clusterLockKey(projectKey), ownerToken).catch((err) => console.error(`cluster lock release failed for ${projectKey}`, err));
  }
}
