// Request clustering (step 13): every case in spec §14.12 and §19.3 "Clustering". Pure. Each fixture states
// its configured threshold, as §14.12 asks.
import { describe, expect, it } from 'vitest';
import {
  canonicalId,
  canonicalRequest,
  ClusterConfig,
  ClusterRecord,
  ClusterRequest,
  clusterKeyPrefix,
  compareStrings,
  decodeClusterKey,
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_MINUTES,
  dismissRecord,
  encodeClusterKey,
  isValidStorageKey,
  reconcileClusters,
  signalForViewer,
  staleRecords,
  withDisplayNames,
  CLUSTER_RECORD_RETENTION_DAYS,
} from '../cluster';

const T0 = Date.parse('2026-12-04T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const NOW = new Date(T0 + 30 * 60_000); // 30 minutes after the first request
const TWO: ClusterConfig = { windowMinutes: 90, threshold: 2 }; // fixture threshold: 2
const DEFAULTS: ClusterConfig = { windowMinutes: DEFAULT_WINDOW_MINUTES, threshold: DEFAULT_THRESHOLD };

const req = (key: string, min: number, services: string[] = [], assets: string[] = []): ClusterRequest => ({
  key,
  createdAt: at(min),
  serviceIds: services,
  entities: assets.map((id) => ({ kind: 'asset' as const, id })),
});
let n = 0;
const ids = () => `sig-${++n}`;
const run = (requests: ClusterRequest[], existing: ClusterRecord[] = [], config = TWO, now = NOW) => reconcileClusters('PAY', requests, existing, config, now, ids);
/** Applies writes to a record list, like the storage adapter does (same key overwrites). */
const apply = (records: ClusterRecord[], writes: ClusterRecord[]) => {
  const map = new Map(records.map((r) => [r.storageKey, r]));
  for (const w of writes) map.set(w.storageKey, w);
  return [...map.values()];
};
const kinds = (writes: ClusterRecord[]) => writes.map((w) => `${w.identityType}/${w.lifecycle}`).sort();

describe('grouping (§14.3)', () => {
  it('open requests sharing only words produce no signal: identity comes from structured fields only', () => {
    expect(run([req('PAY-1', 0), req('PAY-2', 5)])).toEqual([]);
  });

  it('service only, no entities anywhere: uncertain with reason missing-entity-identity (threshold 2)', () => {
    const [w] = run([req('PAY-1', 0, ['S-001']), req('PAY-2', 5, ['S-001'])]);
    expect(w).toMatchObject({ identityType: 'uncertain-service-only', state: 'uncertain', reason: 'missing-entity-identity', serviceId: 's-001', requestKeys: ['PAY-1', 'PAY-2'] });
    expect(w.entityId).toBeUndefined();
  });

  it('service only with conflicting entities: no service-only cluster over the full candidate set', () => {
    expect(run([req('PAY-1', 0, ['S-001'], ['A-100']), req('PAY-2', 5, ['S-001'], ['A-200'])])).toEqual([]);
  });

  it('entity only, no services anywhere: uncertain with reason missing-service-identity (threshold 2)', () => {
    const [w] = run([req('PAY-1', 0, [], ['A-200']), req('PAY-2', 5, [], ['A-200'])]);
    expect(w).toMatchObject({ identityType: 'uncertain-entity-only', reason: 'missing-service-identity', entityKind: 'asset', entityId: 'a-200' });
    expect(w.serviceId).toBeUndefined();
  });

  it('entity only with conflicting services: no entity-only cluster', () => {
    expect(run([req('PAY-1', 0, ['S-001'], ['A-200']), req('PAY-2', 5, ['S-002'], ['A-200'])])).toEqual([]);
  });

  it('confirmed: both identities shared, no conflicts (threshold 2); no weaker uncertain signal beside it', () => {
    const writes = run([req('PAY-1', 0, ['S-001'], ['A-100']), req('PAY-2', 5, ['S-001'], ['A-100'])]);
    expect(kinds(writes)).toEqual(['confirmed/raised']);
    expect(writes[0]).toMatchObject({ state: 'confirmed', serviceId: 's-001', entityKind: 'asset', entityId: 'a-100' });
    expect(writes[0].reason).toBeUndefined();
  });

  it('confirmed at the default threshold of 5', () => {
    const five = [0, 5, 10, 15, 20].map((m, i) => req(`PAY-${i + 1}`, m, ['S-001'], ['A-100']));
    expect(kinds(run(five, [], DEFAULTS))).toEqual(['confirmed/raised']);
    expect(run(five.slice(0, 4), [], DEFAULTS)).toEqual([]);
  });

  it('confirmed is blocked by a conflicting entity in the candidate set', () => {
    const writes = run([req('PAY-1', 0, ['S-001'], ['A-100']), req('PAY-2', 5, ['S-001'], ['A-100']), req('PAY-3', 6, ['S-001'], ['A-200'])]);
    expect(writes).toEqual([]);
  });

  it('missing is allowed, conflicting is not: a request without the entity does not block confirmed', () => {
    const writes = run([req('PAY-1', 0, ['S-001'], ['A-100']), req('PAY-2', 5, ['S-001'], ['A-100']), req('PAY-3', 6, ['S-001'])]);
    expect(kinds(writes)).toEqual(['confirmed/raised']);
    expect(writes[0].requestKeys).toEqual(['PAY-1', 'PAY-2']);
  });

  it('different IDs with similar names do not cluster: no fuzzy matching', () => {
    expect(run([req('PAY-1', 0, [], ['laptop-0042']), req('PAY-2', 5, [], ['laptop-0043'])])).toEqual([]);
  });

  it('no residual-set exclusion: conflicting entities stop the service-only cluster even with extra entity-less requests', () => {
    const requests = [req('PAY-1', 0, ['S-001']), req('PAY-2', 1, ['S-001']), req('PAY-3', 2, ['S-001']), req('PAY-4', 3, ['S-001'], ['A-100']), req('PAY-5', 4, ['S-001'], ['A-200'])];
    expect(run(requests, [], { windowMinutes: 90, threshold: 3 })).toEqual([]); // fixture threshold: 3
  });

  it('requests outside one window do not combine', () => {
    expect(run([req('PAY-1', 0, ['S-001']), req('PAY-2', 91, ['S-001'])], [], TWO, new Date(T0 + 100 * 60_000))).toEqual([]);
  });
});

describe('lifecycle and idempotency (§14.6-§14.8)', () => {
  const pair = [req('PAY-1', 0, ['S-001'], ['A-100']), req('PAY-2', 5, ['S-001'], ['A-100'])];

  it('crossing the threshold raises one signal; re-running over the same state writes nothing', () => {
    const first = run(pair);
    expect(first).toHaveLength(1);
    expect(run(pair, first)).toEqual([]);
  });

  it('a new matching request inside the window is an update with the same window, not a second signal', () => {
    const records = run(pair);
    const [u] = run([...pair, req('PAY-3', 20, ['S-001'], ['A-100'])], records);
    expect(u).toMatchObject({ lifecycle: 'updated', signalId: records[0].signalId, storageKey: records[0].storageKey, windowStart: records[0].windowStart, windowEnd: records[0].windowEnd });
    expect(u.requestKeys).toEqual(['PAY-1', 'PAY-2', 'PAY-3']);
  });

  it('the window anchor is the earliest request and never moves on later passes', () => {
    const records = run(pair);
    expect(records[0].windowStart).toBe(at(0));
    expect(records[0].windowEnd).toBe(at(90));
    const later = apply(records, run([...pair, req('PAY-3', 20, ['S-001'], ['A-100'])], records));
    expect(later[0].windowStart).toBe(at(0));
    expect(run([...pair, req('PAY-3', 20, ['S-001'], ['A-100'])], later)).toEqual([]);
  });

  it('a request after windowEnd does not extend the signal', () => {
    const records = run(pair);
    expect(run([...pair, req('PAY-3', 95, ['S-001'], ['A-100'])], records, TWO, new Date(T0 + 50 * 60_000))).toEqual([]);
  });

  it('expires when the window ends; a later re-cross gets a new signalId and a new windowStart', () => {
    const records = run(pair);
    const expired = run(pair, records, TWO, new Date(T0 + 91 * 60_000));
    expect(kinds(expired)).toEqual(['confirmed/expired']);
    const after = apply(records, expired);
    const again = [req('PAY-8', 100, ['S-001'], ['A-100']), req('PAY-9', 101, ['S-001'], ['A-100'])];
    const [re] = run([...pair, ...again], after, TWO, new Date(T0 + 110 * 60_000));
    expect(re).toMatchObject({ lifecycle: 'raised', windowStart: at(100), requestKeys: ['PAY-8', 'PAY-9'] });
    expect(re.signalId).not.toBe(records[0].signalId);
    expect(re.storageKey).not.toBe(records[0].storageKey);
  });

  it('expires when requests close and the open count falls below threshold', () => {
    const records = run(pair);
    expect(kinds(run(pair.slice(0, 1), records))).toEqual(['confirmed/expired']);
  });

  it('expires when a conflicting request joins the window', () => {
    const records = run(pair);
    expect(kinds(run([...pair, req('PAY-3', 10, ['S-001'], ['A-200'])], records))).toEqual(['confirmed/expired']);
  });

  it('no silent promotion: an uncertain signal stays uncertain when the missing half appears later', () => {
    const svc = [req('PAY-1', 0, ['S-001']), req('PAY-2', 5, ['S-001'])];
    const records = run(svc);
    expect(records[0].identityType).toBe('uncertain-service-only');
    const writes = run([req('PAY-1', 0, ['S-001'], ['A-100']), req('PAY-2', 5, ['S-001'])], records);
    const kept = apply(records, writes).find((r) => r.signalId === records[0].signalId)!;
    expect(kept.state).toBe('uncertain');
  });

  it('a dismissed signal is resolved, is not raised again in its window, and is not shown', () => {
    const records = run(pair);
    const dismissed = dismissRecord(records[0], NOW);
    expect(dismissed).toMatchObject({ lifecycle: 'resolved', resolvedAt: NOW.toISOString() });
    expect(run(pair, [dismissed])).toEqual([]);
    expect(signalForViewer(dismissed, new Set(['PAY-1', 'PAY-2']), NOW)).toBeUndefined();
    expect(dismissRecord(dismissed, NOW)).toBe(dismissed); // only active signals change
  });

  it('does not show a signal once its window has ended, even before a pass marks it expired', () => {
    const [rec] = run(pair);
    const visible = new Set(['PAY-1', 'PAY-2']);
    const end = Date.parse(rec.windowEnd);
    expect(rec.lifecycle).toBe('raised');
    expect(signalForViewer(rec, visible, new Date(end))).toBeDefined();
    expect(signalForViewer(rec, visible, new Date(end + 1))).toBeUndefined();
  });

  it('never raises a signal whose window has already ended, but finds a later open window', () => {
    const old = [req('PAY-1', 0, ['S-001']), req('PAY-2', 5, ['S-001'])];
    const late = new Date(T0 + 200 * 60_000);
    expect(run(old, [], TWO, late)).toEqual([]);
    const [w] = run([...old, req('PAY-3', 150, ['S-001']), req('PAY-4', 160, ['S-001'])], [], TWO, late);
    expect(w.windowStart).toBe(at(150));
  });

  it('only reconciles records of its own project', () => {
    const other = { ...run(pair)[0], projectKey: 'OPS' };
    expect(run([], [other])).toEqual([]);
  });
});

describe('evidence pack (§14.11)', () => {
  it('lists every request with an explicit evidence ID and the structured field it matched', () => {
    const [w] = run([req('PAY-2', 5, ['S-001'], ['A-100']), req('PAY-1', 0, ['S-001'], ['A-100'])]);
    expect(w.evidence).toEqual([
      { evidenceId: 'PAY-1#service', ticketKey: 'PAY-1', matchedOn: 'serviceAssociation:s-001' },
      { evidenceId: 'PAY-1#asset', ticketKey: 'PAY-1', matchedOn: 'assetId:a-100' },
      { evidenceId: 'PAY-2#service', ticketKey: 'PAY-2', matchedOn: 'serviceAssociation:s-001' },
      { evidenceId: 'PAY-2#asset', ticketKey: 'PAY-2', matchedOn: 'assetId:a-100' },
    ]);
  });
});

describe('permission filtering at retrieval (§14.9)', () => {
  const [rec] = run([req('PAY-1', 0, ['S-001']), req('PAY-2', 1, ['S-001']), req('PAY-3', 2, ['S-001'])], [], { windowMinutes: 90, threshold: 2 });

  it('limits requestKeys and evidence to visible tickets', () => {
    const s = signalForViewer(rec, new Set(['PAY-1', 'PAY-3']), NOW)!;
    expect(s.requestKeys).toEqual(['PAY-1', 'PAY-3']);
    expect(s.requestCount).toBe(2);
    expect(s.evidence.map((e) => e.ticketKey)).toEqual(['PAY-1', 'PAY-3']);
    expect(JSON.stringify(s)).not.toContain('PAY-2');
    expect(s).toMatchObject({ state: 'uncertain', reason: 'missing-entity-identity', serviceId: 's-001', expiresAt: rec.windowEnd });
  });

  it('returns nothing when the visible requests fall below the signal threshold', () => {
    expect(signalForViewer(rec, new Set(['PAY-1']), NOW)).toBeUndefined();
    expect(signalForViewer(rec, new Set(), NOW)).toBeUndefined();
  });

  it('shows entity identity, and no reason, for a confirmed signal', () => {
    const [c] = run([req('PAY-1', 0, ['S-001'], ['A-1']), req('PAY-2', 1, ['S-001'], ['A-1'])]);
    const s = signalForViewer(c, new Set(['PAY-1', 'PAY-2']), NOW)!;
    expect(s).toMatchObject({ state: 'confirmed', entityKind: 'asset', entityId: 'a-1' });
    expect(s.reason).toBeUndefined();
  });
});

describe('cluster storage key (§18.7)', () => {
  const examples = [
    'cluster:PAY:confirmed:S_2D001:asset:A_2D100:2026_2D12_2D04T10_3A00_3A00Z',
    'cluster:PAY:uncertain-service-only:S_2D001:-:-:2026_2D12_2D04T10_3A00_3A00Z',
    'cluster:PAY:uncertain-entity-only:-:asset:A_2D200:2026_2D12_2D04T10_3A00_3A00Z',
  ];

  it('round-trips every identity shape, including absent components and delimiter characters', () => {
    const shapes = [
      { projectKey: 'PAY', identityType: 'confirmed' as const, serviceId: 'S-001', entityKind: 'asset' as const, entityId: 'A-100', windowStart: '2026-12-04T10:00:00Z' },
      { projectKey: 'PAY', identityType: 'uncertain-service-only' as const, serviceId: 'ari:cloud:graph::service/a/b c%', windowStart: '2026-12-04T10:00:00Z' },
      { projectKey: 'PAY', identityType: 'uncertain-entity-only' as const, entityKind: 'component' as const, entityId: '-', windowStart: '2026-12-04T10:00:00Z' },
    ];
    for (const s of shapes) expect(decodeClusterKey(encodeClusterKey(s))).toEqual({ serviceId: undefined, entityKind: undefined, entityId: undefined, ...s });
    for (const k of examples) expect(encodeClusterKey(decodeClusterKey(k)!)).toBe(k);
  });

  it('distinguishes absent from a literal "-" and from each other identity type', () => {
    const base = { projectKey: 'PAY', windowStart: 'w' };
    const keys = new Set([
      encodeClusterKey({ ...base, identityType: 'uncertain-entity-only', entityKind: 'asset', entityId: '-' }),
      encodeClusterKey({ ...base, identityType: 'uncertain-entity-only', entityKind: 'asset', entityId: 'x' }),
      encodeClusterKey({ ...base, identityType: 'uncertain-service-only', serviceId: 'x' }),
      encodeClusterKey({ ...base, identityType: 'confirmed', serviceId: 'x', entityKind: 'asset', entityId: 'x' }),
    ]);
    expect(keys.size).toBe(4);
    expect(encodeClusterKey({ ...base, identityType: 'uncertain-entity-only', entityKind: 'asset', entityId: '-' })).toContain(':_2D:w');
  });

  it('only produces keys Forge KVS accepts, for real ARIs, ISO timestamps and awkward characters', () => {
    const awkward = ['ari:cloud:graph::service/414c92ba-476b-40d4-b372-dc77303709e2/d93ef769-3160-46c8-a894-fb4f6dc8a48e', 'a_b%c/d e!~*()\'', 'Zürich ✓', '10014'];
    for (const v of awkward) {
      const key = encodeClusterKey({ projectKey: 'ITS', identityType: 'confirmed', serviceId: v, entityKind: 'component', entityId: v, windowStart: '2026-11-23T10:30:00.000Z' });
      expect(isValidStorageKey(key)).toBe(true);
      expect(decodeClusterKey(key)).toMatchObject({ serviceId: v, entityId: v, windowStart: '2026-11-23T10:30:00.000Z' });
    }
    expect(isValidStorageKey('cluster:a%2Db')).toBe(false);
    expect(isValidStorageKey('   ')).toBe(false);
    expect(isValidStorageKey('a'.repeat(501))).toBe(false);
  });

  it('rejects anything that is not a well-formed key', () => {
    for (const bad of ['', 'bundle:ITS-1', 'cluster:PAY:confirmed:a:b:c', 'cluster:PAY:weird:-:-:-:w', 'cluster:-:confirmed:-:-:-:w', 'cluster:PAY:confirmed:-:host:x:w', 'cluster:PAY:confirmed:_E0_A4:-:-:w', 'cluster:PAY:confirmed:-:-:-:-', undefined as never]) {
      expect(decodeClusterKey(bad)).toBeUndefined();
    }
  });

  it('gives each project its own key prefix', () => {
    expect(encodeClusterKey({ projectKey: 'PAY', identityType: 'uncertain-service-only', serviceId: 's', windowStart: 'w' }).startsWith(clusterKeyPrefix('PAY'))).toBe(true);
    expect(clusterKeyPrefix('PA')).toBe('cluster:PA:');
  });
});

describe('canonicalization (§14.4)', () => {
  it('trims and case-folds, treats empty as absent, accepts numeric IDs and rejects anything else', () => {
    expect(canonicalId('  S-001 ')).toBe('s-001');
    expect(canonicalId(42)).toBe('42');
    expect(canonicalId('   ')).toBeUndefined();
    expect(canonicalId(null)).toBeUndefined();
    expect(canonicalId({})).toBeUndefined();
  });

  it('de-duplicates identity values and sorts them, so the same request always canonicalizes the same way', () => {
    const r = canonicalRequest({ key: 'PAY-1', createdAt: at(0), serviceIds: ['S-2', ' s-2', 'S-1', ''], entities: [{ kind: 'asset', id: 'B' }, { kind: 'asset', id: 'b ' }, { kind: 'component', id: 'A' }, { kind: 'asset', id: '' }] });
    expect(r.serviceIds).toEqual(['s-1', 's-2']);
    expect(r.entities).toEqual([{ kind: 'asset', id: 'b' }, { kind: 'component', id: 'a' }]);
  });

  it('matches the same identity written in different case or spacing', () => {
    expect(kinds(run([req('PAY-1', 0, [' S-001 ']), req('PAY-2', 5, ['s-001'])]))).toEqual(['uncertain-service-only/raised']);
  });

  it('ignores requests with an unreadable created date', () => {
    expect(run([req('PAY-1', 0, ['S-001']), { ...req('PAY-2', 5, ['S-001']), createdAt: 'not a date' }])).toEqual([]);
  });
});

describe('ordering', () => {
  it('compares strings for sorting: before, after and equal', () => {
    expect(compareStrings('a', 'b')).toBe(-1);
    expect(compareStrings('b', 'a')).toBe(1);
    expect(compareStrings('a', 'a')).toBe(0);
  });

  it('orders requests created at the same instant by key, so the evidence order is stable', () => {
    const [w] = run([req('PAY-9', 0, ['S-001']), req('PAY-1', 0, ['S-001'])]);
    expect(w.requestKeys).toEqual(['PAY-1', 'PAY-9']);
    expect(w.windowStart).toBe(at(0));
  });

  it('shows an entity-only signal without a service', () => {
    const [e] = run([req('PAY-1', 0, [], ['A-7']), req('PAY-2', 1, [], ['A-7'])]);
    const s = signalForViewer(e, new Set(['PAY-1', 'PAY-2']), NOW)!;
    expect(s).toMatchObject({ state: 'uncertain', reason: 'missing-service-identity', entityId: 'a-7' });
    expect(s.serviceId).toBeUndefined();
  });

  it('raises no uncertain signal when every request carries both halves but the confirmed one is blocked', () => {
    // Both share S-001 and A-100; a third request with S-001 and A-200 blocks confirmed. No "missing" half exists.
    expect(run([req('PAY-1', 0, ['S-001'], ['A-100']), req('PAY-2', 5, ['S-001'], ['A-100']), req('PAY-3', 6, ['S-001'], ['A-200'])])).toEqual([]);
  });
});

describe('display names and housekeeping', () => {
  it('adds the latest service and entity names, keeps earlier ones, and never invents one', () => {
    const [c] = run([req('PAY-1', 0, ['S-001'], ['A-1']), req('PAY-2', 1, ['S-001'], ['A-1'])]);
    const [named] = withDisplayNames([c], new Map([['s-001', 'Infrastructure Services']]), new Map([['a-1', 'VPN Server']]));
    expect(named).toMatchObject({ serviceName: 'Infrastructure Services', entityName: 'VPN Server' });
    const [kept] = withDisplayNames([named], new Map(), new Map());
    expect(kept).toMatchObject({ serviceName: 'Infrastructure Services', entityName: 'VPN Server' });
    const [none] = withDisplayNames([c], new Map(), new Map());
    expect(none.serviceName).toBeUndefined();
    expect(none.entityName).toBeUndefined();
    const [svcOnly] = run([req('PAY-1', 0, ['S-9']), req('PAY-2', 1, ['S-9'])]);
    expect(withDisplayNames([svcOnly], new Map([['s-9', 'Email']]), new Map([['a-1', 'x']]))[0]).toMatchObject({ serviceName: 'Email' });
    expect(withDisplayNames([svcOnly], new Map([['s-9', 'Email']]), new Map())[0].entityName).toBeUndefined();
    const [entityOnly] = run([req('PAY-1', 0, [], ['A-5']), req('PAY-2', 1, [], ['A-5'])]);
    const [e] = withDisplayNames([entityOnly], new Map([['s-9', 'Email']]), new Map([['a-5', 'Printers']]));
    expect(e).toMatchObject({ entityName: 'Printers' });
    expect(e.serviceName).toBeUndefined();
  });

  it('passes display names through to the viewer, and only names that exist', () => {
    const [c] = run([req('PAY-1', 0, ['S-001'], ['A-1']), req('PAY-2', 1, ['S-001'], ['A-1'])]);
    const [named] = withDisplayNames([c], new Map([['s-001', 'Infrastructure Services']]), new Map([['a-1', 'VPN Server']]));
    expect(signalForViewer(named, new Set(['PAY-1', 'PAY-2']), NOW)).toMatchObject({ serviceName: 'Infrastructure Services', entityName: 'VPN Server' });
    const plain = signalForViewer(c, new Set(['PAY-1', 'PAY-2']), NOW)!;
    expect('serviceName' in plain).toBe(false);
    expect('entityName' in plain).toBe(false);
  });
  it('deletes only inactive records whose window ended more than the retention period ago', () => {
    const [c] = run([req('PAY-1', 0, ['S-001']), req('PAY-2', 1, ['S-001'])]);
    const later = new Date(Date.parse(c.windowEnd) + (CLUSTER_RECORD_RETENTION_DAYS * 86_400_000 + 60_000));
    const expired = { ...c, lifecycle: 'expired' as const };
    expect(staleRecords([c, expired], later)).toEqual([expired]);
    expect(staleRecords([expired], new Date(Date.parse(c.windowEnd) + 60_000))).toEqual([]);
    expect(CLUSTER_RECORD_RETENTION_DAYS).toBe(7);
  });
});
