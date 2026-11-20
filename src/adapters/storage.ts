// KVS storage for bundles and build status (spec §18).
// Keys are namespaced: bundle:<ticketKey>, status:<ticketKey>.
import { kvs } from '@forge/kvs';
import { BuildStatus, ContextBundle } from '../domain/types';

const bundleKey = (ticketKey: string) => `bundle:${ticketKey}`;
const statusKey = (ticketKey: string) => `status:${ticketKey}`;

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
