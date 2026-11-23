// Request clustering (step 13, spec §14, §18.7). Pure: no Forge imports, no I/O, no clock reads.
//
// Identity comes only from structured fields (§14.2): the service from the JSM Affected services field, the
// entity from one configured Assets object field or Jira Components. Free text never establishes either, so
// two requests that only share words produce no signal at all (§14.12).
//
// Rules implemented here, in spec terms:
// - Open requests only (§14.1). The caller passes only open requests; closing one removes it on the next pass.
// - Confirmed (§14.3): >= threshold distinct requests carry both the service S and the entity E, within one
//   window, and no request in the candidate set (all requests in that window carrying S or E) carries a
//   different known service or entity.
// - Uncertain (§14.3): >= threshold requests share one half, and no request in that candidate set carries a
//   different known value for the other half. "Missing is allowed; conflicting is not." No subset is carved out.
//   Agreed decision: the other half must actually be missing on at least one of those requests. If all carry both
//   halves, only a confirmed signal may form, so a reason such as missing-service-identity is always true.
// - Agreed decision: an uncertain signal is not raised for a service or entity that a confirmed signal already
//   covers in the same pass, so one set of requests never produces a stronger and a weaker signal at once.
// - Window identity (§14.6): windowStart is the earliest createdAt among the cluster's requests, windowEnd is
//   windowStart + windowMinutes, both fixed for the signal's life. A new signal for the same identity can only
//   start from requests created after the previous signal's windowEnd.
// - Lifecycle (§14.7, §14.8): raised, updated only when requestKeys or evidence change, resolved by a human
//   (Dismiss), expired when the window ends or the requests fall below threshold. State never changes: an
//   uncertain signal is not promoted to confirmed (§14.3).

export type EntityKind = 'asset' | 'component' | 'endpoint';
export type IdentityType = 'confirmed' | 'uncertain-service-only' | 'uncertain-entity-only';
export type Lifecycle = 'raised' | 'updated' | 'resolved' | 'expired';

/** One open request as the clustering pass sees it: structured identity only, canonicalized. */
export type ClusterRequest = {
  key: string;
  createdAt: string;
  serviceIds: string[];
  entities: { kind: EntityKind; id: string }[];
};

export type ClusterConfig = { windowMinutes: number; threshold: number };

// §14.5 defaults, and the bounds accepted on the settings page.
export const DEFAULT_WINDOW_MINUTES = 90;
export const DEFAULT_THRESHOLD = 5;
export const MIN_WINDOW_MINUTES = 15;
export const MAX_WINDOW_MINUTES = 10_080; // 7 days
export const MIN_THRESHOLD = 2;
export const MAX_THRESHOLD = 50;

export type Evidence = { evidenceId: string; ticketKey: string; matchedOn: string };

/** Persisted form (§7.6): the unfiltered set. Never returned to a viewer as is. */
export type ClusterRecord = {
  storageKey: string;
  signalId: string;
  projectKey: string;
  identityType: IdentityType;
  state: 'confirmed' | 'uncertain';
  reason?: 'missing-entity-identity' | 'missing-service-identity';
  serviceId?: string;
  entityKind?: EntityKind;
  entityId?: string;
  windowStart: string;
  windowEnd: string;
  threshold: number;
  raisedAt: string;
  lastUpdatedAt: string;
  lifecycle: Lifecycle;
  requestKeys: string[];
  evidence: Evidence[];
  resolvedAt?: string;
  // Display only (the signal card); never used for matching (§14.4).
  serviceName?: string;
  entityName?: string;
};

/** Response form (§7.5): filtered per caller at read time. */
export type ClusterSignal = {
  signalId: string;
  projectKey: string;
  state: 'confirmed' | 'uncertain';
  reason?: string;
  windowStart: string;
  windowEnd: string;
  raisedAt: string;
  lastUpdatedAt: string;
  expiresAt: string;
  serviceId?: string;
  serviceName?: string;
  entityKind?: EntityKind;
  entityId?: string;
  entityName?: string;
  requestKeys: string[];
  requestCount: number;
  evidence: Evidence[];
};

/** Plain string order, used by every sort here so results never depend on input order. */
export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---- Canonicalization (§14.4) ----

/** Trimmed and case-folded; empty means absent. No fuzzy matching: distinct IDs stay distinct. */
export function canonicalId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const v = String(value).trim().toLowerCase();
  return v.length > 0 ? v : undefined;
}

/** A request with its identity values canonicalized and de-duplicated. */
export function canonicalRequest(r: ClusterRequest): ClusterRequest {
  const services = [...new Set(r.serviceIds.map(canonicalId).filter((v): v is string => !!v))].sort();
  const seen = new Set<string>();
  const entities: ClusterRequest['entities'] = [];
  for (const e of r.entities) {
    const id = canonicalId(e.id);
    if (!id || seen.has(`${e.kind}:${id}`)) continue;
    seen.add(`${e.kind}:${id}`);
    entities.push({ kind: e.kind, id });
  }
  entities.sort((a, b) => compareStrings(`${a.kind}:${a.id}`, `${b.kind}:${b.id}`));
  return { ...r, serviceIds: services, entities };
}

// ---- Storage key (§18.7) ----

// Forge KVS keys only allow [a-zA-Z0-9:._\s-#], so a segment keeps letters, digits and "." and escapes every other
// byte as "_XX" (percent-encoding with "_" in place of "%"). "_" itself is always escaped, so decoding is exact,
// and "-" (the absent marker) and ":" (the separator) never appear inside an encoded value.
const KVS_KEY_PATTERN = /^(?!\s+$)[a-zA-Z0-9:._\s\-#]+$/;
const hex = (c: string): string => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
const enc = (v: string | undefined): string =>
  v === undefined ? '-' : encodeURIComponent(v).replace(/[-_!~*'()]/g, hex).replace(/%/g, '_');
const dec = (v: string): string | undefined => (v === '-' ? undefined : decodeURIComponent(v.replace(/_/g, '%')));
/** True when a string is accepted as a Forge KVS key. */
export const isValidStorageKey = (key: string): boolean => KVS_KEY_PATTERN.test(key) && key.length <= 500;

type KeyParts = { projectKey: string; identityType: IdentityType; serviceId?: string; entityKind?: EntityKind; entityId?: string; windowStart: string };

/** cluster:<projectKey>:<identityType>:<serviceId>:<entityKind>:<entityId>:<windowStart>, "-" for absent. */
export function encodeClusterKey(p: KeyParts): string {
  return ['cluster', enc(p.projectKey), p.identityType, enc(p.serviceId), enc(p.entityKind), enc(p.entityId), enc(p.windowStart)].join(':');
}

const IDENTITY_TYPES: IdentityType[] = ['confirmed', 'uncertain-service-only', 'uncertain-entity-only'];
const ENTITY_KINDS: EntityKind[] = ['asset', 'component', 'endpoint'];

/** The inverse of encodeClusterKey; undefined for anything that is not a well-formed cluster key. */
export function decodeClusterKey(key: string): KeyParts | undefined {
  const parts = typeof key === 'string' ? key.split(':') : [];
  if (parts.length !== 7 || parts[0] !== 'cluster' || !IDENTITY_TYPES.includes(parts[2] as IdentityType)) return undefined;
  try {
    const projectKey = dec(parts[1]);
    const windowStart = dec(parts[6]);
    const entityKind = dec(parts[4]) as EntityKind | undefined;
    if (!projectKey || !windowStart || (entityKind !== undefined && !ENTITY_KINDS.includes(entityKind))) return undefined;
    return { projectKey, identityType: parts[2] as IdentityType, serviceId: dec(parts[3]), entityKind, entityId: dec(parts[5]), windowStart };
  } catch {
    return undefined;
  }
}

/** The key prefix for one project's records (KVS begins-with query). */
export const clusterKeyPrefix = (projectKey: string): string => `cluster:${enc(projectKey)}:`;

// ---- Grouping (§14.3) ----

type Identity = { identityType: IdentityType; serviceId?: string; entityKind?: EntityKind; entityId?: string };
const identityId = (i: Identity) => [i.identityType, i.serviceId ?? '-', i.entityKind ?? '-', i.entityId ?? '-'].join('|');

const hasService = (r: ClusterRequest, s: string) => r.serviceIds.includes(s);
const hasEntity = (r: ClusterRequest, kind: EntityKind, id: string) => r.entities.some((e) => e.kind === kind && e.id === id);

/** Members, candidate set and conflict check for one identity over a set of requests (one window). */
function evaluate(identity: Identity, requests: ClusterRequest[]): { members: ClusterRequest[]; conflict: boolean } {
  const s = identity.serviceId;
  const kind = identity.entityKind;
  const id = identity.entityId;
  const otherService = (r: ClusterRequest) => r.serviceIds.some((x) => x !== s);
  const otherEntity = (r: ClusterRequest) => r.entities.some((e) => !(e.kind === kind && e.id === id));
  if (identity.identityType === 'confirmed') {
    const candidates = requests.filter((r) => hasService(r, s!) || hasEntity(r, kind!, id!));
    return { members: candidates.filter((r) => hasService(r, s!) && hasEntity(r, kind!, id!)), conflict: candidates.some((r) => otherService(r) || otherEntity(r)) };
  }
  if (identity.identityType === 'uncertain-service-only') {
    const candidates = requests.filter((r) => hasService(r, s!));
    const known = new Set(candidates.flatMap((r) => r.entities.map((e) => `${e.kind}:${e.id}`)));
    return { members: candidates, conflict: known.size > 1 };
  }
  const candidates = requests.filter((r) => hasEntity(r, kind!, id!));
  const known = new Set(candidates.flatMap((r) => r.serviceIds));
  return { members: candidates, conflict: known.size > 1 };
}

/** Every identity the requests could form, uncertain ones last so confirmed coverage is known first. */
function identitiesOf(requests: ClusterRequest[]): Identity[] {
  const confirmed = new Map<string, Identity>();
  const services = new Set<string>();
  const entities = new Map<string, { kind: EntityKind; id: string }>();
  for (const r of requests) {
    for (const s of r.serviceIds) services.add(s);
    for (const e of r.entities) entities.set(`${e.kind}:${e.id}`, e);
    for (const s of r.serviceIds) for (const e of r.entities) {
      const i: Identity = { identityType: 'confirmed', serviceId: s, entityKind: e.kind, entityId: e.id };
      confirmed.set(identityId(i), i);
    }
  }
  const sorted = <T>(m: Map<string, T>) => [...m.entries()].sort((a, b) => compareStrings(a[0], b[0])).map(([, v]) => v);
  return [
    ...sorted(confirmed),
    ...[...services].sort().map((s): Identity => ({ identityType: 'uncertain-service-only', serviceId: s })),
    ...sorted(entities).map((e): Identity => ({ identityType: 'uncertain-entity-only', entityKind: e.kind, entityId: e.id })),
  ];
}

const minutes = (n: number) => n * 60_000;

/**
 * The earliest window in which the identity qualifies: anchored at a member's createdAt (not before notBefore),
 * containing every request created within windowMinutes of it, with >= threshold members and no conflict.
 */
function firstQualifyingWindow(identity: Identity, requests: ClusterRequest[], config: ClusterConfig, notBefore: number): { start: number; members: ClusterRequest[] } | undefined {
  const byTime = [...requests].filter((r) => Number.isFinite(Date.parse(r.createdAt))).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || compareStrings(a.key, b.key));
  for (const anchor of evaluate(identity, byTime).members) {
    const start = Date.parse(anchor.createdAt);
    if (start < notBefore) continue;
    const inWindow = byTime.filter((r) => {
      const t = Date.parse(r.createdAt);
      return t >= start && t <= start + minutes(config.windowMinutes);
    });
    const { members, conflict } = evaluate(identity, inWindow);
    // An uncertain signal needs its missing half to be missing on at least one request. If every request
    // carries both halves, only a confirmed signal may form (or none, when that one is blocked by a conflict).
    const fullyIdentified = identity.identityType !== 'confirmed' && members.every((r) => (identity.identityType === 'uncertain-service-only' ? r.entities.length > 0 : r.serviceIds.length > 0));
    if (!conflict && !fullyIdentified && members.length >= config.threshold) return { start, members };
  }
  return undefined;
}

function evidenceFor(identity: Identity, members: ClusterRequest[]): Evidence[] {
  const out: Evidence[] = [];
  for (const r of [...members].sort((a, b) => compareStrings(a.key, b.key))) {
    if (identity.serviceId) out.push({ evidenceId: `${r.key}#service`, ticketKey: r.key, matchedOn: `serviceAssociation:${identity.serviceId}` });
    if (identity.entityId) out.push({ evidenceId: `${r.key}#${identity.entityKind}`, ticketKey: r.key, matchedOn: `${identity.entityKind}Id:${identity.entityId}` });
  }
  return out;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
/** True while a signal is shown: raised or updated, not resolved or expired. */
export const isActiveRecord = (r: ClusterRecord): boolean => r.lifecycle === 'raised' || r.lifecycle === 'updated';
const isActive = isActiveRecord;

/**
 * One clustering pass for one project: the records to write. Pure and idempotent: running it again over the
 * same requests and records writes nothing (§14.8). newSignalId supplies IDs for newly raised signals.
 */
export function reconcileClusters(projectKey: string, input: ClusterRequest[], existing: ClusterRecord[], config: ClusterConfig, now: Date, newSignalId: () => string): ClusterRecord[] {
  const requests = input.map(canonicalRequest);
  const nowIso = now.toISOString();
  const writes: ClusterRecord[] = [];
  const records = existing.filter((r) => r.projectKey === projectKey);

  // 1. Existing active signals: keep, update, or expire. Their window never moves.
  for (const rec of records.filter(isActive)) {
    const identity: Identity = { identityType: rec.identityType, serviceId: rec.serviceId, entityKind: rec.entityKind, entityId: rec.entityId };
    if (Date.parse(rec.windowEnd) < now.getTime()) {
      writes.push({ ...rec, lifecycle: 'expired', lastUpdatedAt: nowIso });
      continue;
    }
    const inWindow = requests.filter((r) => {
      const t = Date.parse(r.createdAt);
      return t >= Date.parse(rec.windowStart) && t <= Date.parse(rec.windowEnd);
    });
    const { members, conflict } = evaluate(identity, inWindow);
    if (conflict || members.length < rec.threshold) {
      writes.push({ ...rec, lifecycle: 'expired', lastUpdatedAt: nowIso });
      continue;
    }
    const keys = members.map((m) => m.key).sort();
    const evidence = evidenceFor(identity, members);
    if (!sameSet(keys, rec.requestKeys) || !sameSet(evidence.map((e) => e.evidenceId), rec.evidence.map((e) => e.evidenceId))) {
      writes.push({ ...rec, lifecycle: 'updated', requestKeys: keys, evidence, lastUpdatedAt: nowIso });
    }
  }

  // 2. New signals. A new window for an identity must start after every earlier window for it ended, and a
  //    still-active (or dismissed, unexpired) signal blocks a new one for the same identity.
  const stillActive = new Set(records.filter((r) => isActive(r) && !writes.some((w) => w.storageKey === r.storageKey && w.lifecycle === 'expired')).map((r) => identityId(r)));
  const blocked = new Set(records.filter((r) => r.lifecycle === 'resolved' && Date.parse(r.windowEnd) >= now.getTime()).map((r) => identityId(r)));
  const lastEnd = new Map<string, number>();
  for (const r of records) lastEnd.set(identityId(r), Math.max(lastEnd.get(identityId(r)) ?? -Infinity, Date.parse(r.windowEnd)));

  const coveredServices = new Set<string>();
  const coveredEntities = new Set<string>();
  for (const r of records) {
    if (r.identityType === 'confirmed' && (stillActive.has(identityId(r)) || blocked.has(identityId(r)))) {
      coveredServices.add(r.serviceId!);
      coveredEntities.add(`${r.entityKind}:${r.entityId}`);
    }
  }

  for (const identity of identitiesOf(requests)) {
    const id = identityId(identity);
    if (stillActive.has(id) || blocked.has(id)) continue;
    if (identity.identityType === 'uncertain-service-only' && coveredServices.has(identity.serviceId!)) continue;
    if (identity.identityType === 'uncertain-entity-only' && coveredEntities.has(`${identity.entityKind}:${identity.entityId}`)) continue;
    const after = lastEnd.get(id) ?? -Infinity;
    const eligible = requests.filter((r) => Date.parse(r.createdAt) > after);
    // Only windows still open now: a signal is never raised already expired.
    const found = firstQualifyingWindow(identity, eligible, config, now.getTime() - minutes(config.windowMinutes));
    if (!found) continue;
    const windowStart = new Date(found.start).toISOString();
    const windowEnd = new Date(found.start + minutes(config.windowMinutes)).toISOString();
    const record: ClusterRecord = {
      storageKey: encodeClusterKey({ projectKey, ...identity, windowStart }),
      signalId: newSignalId(),
      projectKey,
      identityType: identity.identityType,
      state: identity.identityType === 'confirmed' ? 'confirmed' : 'uncertain',
      ...(identity.identityType === 'uncertain-service-only' ? { reason: 'missing-entity-identity' as const } : {}),
      ...(identity.identityType === 'uncertain-entity-only' ? { reason: 'missing-service-identity' as const } : {}),
      ...(identity.serviceId ? { serviceId: identity.serviceId } : {}),
      ...(identity.entityId ? { entityKind: identity.entityKind, entityId: identity.entityId } : {}),
      windowStart,
      windowEnd,
      threshold: config.threshold,
      raisedAt: nowIso,
      lastUpdatedAt: nowIso,
      lifecycle: 'raised',
      requestKeys: found.members.map((m) => m.key).sort(),
      evidence: evidenceFor(identity, found.members),
    };
    writes.push(record);
    stillActive.add(id);
    if (identity.identityType === 'confirmed') {
      coveredServices.add(identity.serviceId!);
      coveredEntities.add(`${identity.entityKind}:${identity.entityId}`);
    }
  }
  return writes;
}

/** Marks a signal dismissed by a human (§14.7 resolved). Never touches anything in Jira. */
export function dismissRecord(rec: ClusterRecord, now: Date): ClusterRecord {
  return isActive(rec) ? { ...rec, lifecycle: 'resolved', resolvedAt: now.toISOString(), lastUpdatedAt: now.toISOString() } : rec;
}

// ---- Read time (§14.9) ----

/**
 * The signal as one viewer may see it, or undefined. Only active signals; requestKeys and evidence limited to
 * tickets the viewer can see; nothing at all if that leaves fewer than the signal's threshold, so a viewer
 * never learns that hidden tickets exist. The identity is shown only with a visible request that carries it,
 * which every remaining member does. A signal whose window has ended is not shown even before a pass marks it
 * expired (passes run on ticket events and hourly, so the record can lag the window end).
 */
export function signalForViewer(rec: ClusterRecord, visible: Set<string>, now: Date = new Date()): ClusterSignal | undefined {
  if (!isActive(rec) || Date.parse(rec.windowEnd) < now.getTime()) return undefined;
  const requestKeys = rec.requestKeys.filter((k) => visible.has(k));
  if (requestKeys.length < rec.threshold) return undefined;
  return {
    signalId: rec.signalId,
    projectKey: rec.projectKey,
    state: rec.state,
    ...(rec.reason ? { reason: rec.reason } : {}),
    windowStart: rec.windowStart,
    windowEnd: rec.windowEnd,
    raisedAt: rec.raisedAt,
    lastUpdatedAt: rec.lastUpdatedAt,
    expiresAt: rec.windowEnd,
    ...(rec.serviceId ? { serviceId: rec.serviceId } : {}),
    ...(rec.serviceName ? { serviceName: rec.serviceName } : {}),
    ...(rec.entityId ? { entityKind: rec.entityKind, entityId: rec.entityId } : {}),
    ...(rec.entityName ? { entityName: rec.entityName } : {}),
    requestKeys,
    requestCount: requestKeys.length,
    evidence: rec.evidence.filter((e) => visible.has(e.ticketKey)),
  };
}

/** Adds display names (service and entity) from the latest pass to the records being written. */
export function withDisplayNames(writes: ClusterRecord[], serviceNames: Map<string, string>, entityNames: Map<string, string>): ClusterRecord[] {
  return writes.map((w) => {
    const serviceName = w.serviceId ? serviceNames.get(w.serviceId) ?? w.serviceName : undefined;
    const entityName = w.entityId ? entityNames.get(w.entityId) ?? w.entityName : undefined;
    return { ...w, ...(serviceName ? { serviceName } : {}), ...(entityName ? { entityName } : {}) };
  });
}

// Records kept after their window ends, so a re-cross can see the previous windowEnd (§14.6), then deleted.
export const CLUSTER_RECORD_RETENTION_DAYS = 7;

/** Records no longer needed: inactive and ended more than CLUSTER_RECORD_RETENTION_DAYS ago. */
export function staleRecords(records: ClusterRecord[], now: Date): ClusterRecord[] {
  const cutoff = now.getTime() - CLUSTER_RECORD_RETENTION_DAYS * 86_400_000;
  return records.filter((r) => !isActive(r) && Date.parse(r.windowEnd) < cutoff);
}
