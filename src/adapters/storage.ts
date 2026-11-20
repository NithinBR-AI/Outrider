// KVS storage for bundles, build status and per-ticket locks (spec §18).
// Keys are namespaced: bundle:<ticketKey>, status:<ticketKey>, lock:<ticketKey>.
import { kvs } from '@forge/kvs';
import { BuildStatus, ContextBundle } from '../domain/types';

const bundleKey = (ticketKey: string) => `bundle:${ticketKey}`;
const statusKey = (ticketKey: string) => `status:${ticketKey}`;
const lockKey = (ticketKey: string) => `lock:${ticketKey}`;

// ---- Per-ticket lock (spec §8.5) ----
//
// Acquire is an atomic create-if-absent write (keyPolicy FAIL_IF_EXISTS). Expiry cannot rely on the
// KVS TTL: expired keys are deleted asynchronously (up to 48 hours) and, per the Forge Storage team,
// an expired but unswept key still blocks FAIL_IF_EXISTS. So each record carries its own logical
// expiresAt; a conflicting record past that time is taken over. The takeover is a read followed by
// a write, not atomic, so the lock as a whole is best-effort. The write guards in the builder
// (lock owner, status owner, fingerprint) catch the rare overlap. The TTL only cleans up eventually.

// Lease length: the consumer's timeoutSeconds (600) plus a margin, so a running build never
// outlives its own lease.
export const LOCK_LEASE_SECONDS = 660;

export type LockRecord = {
  buildId: string;
  // Unique per acquisition. A redelivered copy of the same build gets a different token, so two
  // copies of one build can never both believe they hold the lock.
  ownerToken: string;
  acquiredAt: string;
  expiresAt: string;
};

export async function getLock(ticketKey: string): Promise<LockRecord | undefined> {
  return kvs.get<LockRecord>(lockKey(ticketKey));
}

function newLock(buildId: string, ownerToken: string, now: Date): LockRecord {
  return {
    buildId,
    ownerToken,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + LOCK_LEASE_SECONDS * 1000).toISOString(),
  };
}

const LOCK_TTL = { unit: 'SECONDS' as const, value: LOCK_LEASE_SECONDS };

/**
 * Tries to acquire the per-ticket lock. Returns the lock record on success, or undefined if another
 * acquisition holds an unexpired lease. An expired lease (for example from a crashed consumer) is
 * taken over.
 */
export async function acquireLock(ticketKey: string, buildId: string, ownerToken: string, now: Date = new Date()): Promise<LockRecord | undefined> {
  const record = newLock(buildId, ownerToken, now);
  try {
    await kvs.set(lockKey(ticketKey), record, { keyPolicy: 'FAIL_IF_EXISTS', ttl: LOCK_TTL });
    return record;
  } catch (err) {
    // The conflict error is not documented. Verified on real KVS (development, 2026-11-20): a
    // FAIL_IF_EXISTS write on an existing key throws ForgeKvsError code KEY_CONFLICT (HTTP 409) and
    // leaves the stored value unchanged; ttl and keyPolicy are both honored in one call.
    // Deciding by re-reading the key keeps this correct even if the error shape changes.
    const existing = await getLock(ticketKey);
    if (!existing) throw err; // Not a conflict: a real storage error.
    if (Date.parse(existing.expiresAt) > now.getTime()) return undefined; // Held by someone else.
    // Expired lease: take it over (best-effort, see above).
    await kvs.set(lockKey(ticketKey), record, { ttl: LOCK_TTL });
    return record;
  }
}

/** True if this acquisition still holds an unexpired lease (spec §8.6 write guard). */
export async function holdsLock(ticketKey: string, ownerToken: string, now: Date = new Date()): Promise<boolean> {
  const current = await getLock(ticketKey);
  return !!current && current.ownerToken === ownerToken && Date.parse(current.expiresAt) > now.getTime();
}

/** Releases the lock only if this acquisition still owns it (spec §8.5 rule 5). Best-effort. */
export async function releaseLock(ticketKey: string, ownerToken: string): Promise<boolean> {
  const current = await getLock(ticketKey);
  if (!current || current.ownerToken !== ownerToken) return false;
  await kvs.delete(lockKey(ticketKey));
  return true;
}

export async function getBundle(ticketKey: string): Promise<ContextBundle | undefined> {
  return kvs.get<ContextBundle>(bundleKey(ticketKey));
}

export async function putBundle(bundle: ContextBundle): Promise<void> {
  await kvs.set(bundleKey(bundle.ticketKey), bundle);
}

export async function getStatus(ticketKey: string): Promise<BuildStatus | undefined> {
  return kvs.get<BuildStatus>(statusKey(ticketKey));
}

export async function putStatus(status: BuildStatus): Promise<void> {
  await kvs.set(statusKey(status.ticketKey), status);
}

/**
 * Updates the status only if the stored record still belongs to this build and is in one of the
 * expected states (spec §6.2, §18.3). This is a read followed by a write, so it is best-effort,
 * not an atomic compare-and-set. Returns whether the write happened.
 */
export async function updateStatusIf(
  ticketKey: string,
  buildId: string,
  expected: BuildStatus['status'][],
  next: Pick<BuildStatus, 'status' | 'error'>,
): Promise<boolean> {
  const current = await getStatus(ticketKey);
  if (!current || current.buildId !== buildId || !expected.includes(current.status)) return false;
  await putStatus({ ...current, status: next.status, error: next.error });
  return true;
}
