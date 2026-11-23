// Mandatory concurrency test (spec §19.4). Release blocker.
//
// Runs the real event handler, builder, storage and lock code. Only Jira, KVS (in memory) and the
// queue are simulated, so the test can pause a build at a chosen point and control delivery order.
//
// What this proves: in the interleavings below, the newer ticket fingerprint is the one stored and
// the older build never overwrites a newer bundle. What it does not prove: that every possible
// interleaving is safe. The design is best-effort (spec §8.5, §8.6, §18.9); results are reported as
// "handled in the observed interleaving", not "guaranteed under all interleavings".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildJob, BuildStatus, ContextBundle, Ticket } from '../../src/domain/types';

type TicketJob = Extract<BuildJob, { kind: 'jira-ticket' }>;

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  pushes: [] as { body: unknown; delayInSeconds?: number }[],
  liveTicket: null as unknown,
  gate: null as null | Promise<void>,
  gatedCalls: 0,
}));

// KVS as documented: FAIL_IF_EXISTS rejects existing keys; expired keys are not removed.
vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => structuredClone(h.store.get(key)),
    set: async (key: string, value: unknown, options?: { keyPolicy?: string }) => {
      if (options?.keyPolicy === 'FAIL_IF_EXISTS' && h.store.has(key)) throw new Error('conflict');
      h.store.set(key, structuredClone(value));
    },
    delete: async (key: string) => void h.store.delete(key),
  },
}));
vi.mock('@forge/events', () => ({
  Queue: class {
    push = async (event: { body: unknown; delayInSeconds?: number }) => {
      // Step 13: ticket events also queue a clustering pass; this suite is about ticket builds only.
      if ((event.body as { kind?: string }).kind === 'cluster-pass') return { jobId: 'cluster' };
      h.pushes.push(event);
      return { jobId: `job-${h.pushes.length}` };
    };
  },
}));
// Jira: always returns the ticket as it is right now. The first incident search can be paused.
vi.mock('../../src/adapters/jira', () => ({
  getTicket: async () => structuredClone(h.liveTicket),
  searchIncidents: async () => {
    if (h.gate && h.gatedCalls++ === 0) await h.gate;
    return [];
  },
  searchResolutions: async () => [],
}));

import { onJiraIssueEvent } from '../../src/pipeline/enqueue';
import { buildTicketBundle } from '../../src/pipeline/buildTicket';
import { ticketFingerprint } from '../../src/domain/extract';
import { LOCK_LEASE_SECONDS } from '../../src/adapters/storage';

const V1: Ticket = { key: 'ITS-1', projectKey: 'ITS', summary: 'Cannot log in', description: 'Error on the login page', labels: [], serviceIds: [], status: 'Open', updatedAt: 'u1' };
const V2: Ticket = { ...V1, summary: 'Cannot log in since the outage', updatedAt: 'u2' };

const T0 = new Date('2026-11-21T10:00:00.000Z');
const bundle = () => h.store.get('bundle:ITS-1') as ContextBundle | undefined;
const status = () => h.store.get('status:ITS-1') as BuildStatus;
const pushedJob = (i: number) => h.pushes[i].body as TicketJob;

/** Pauses the first build at retrieval until release() is called. */
function pauseFirstBuild() {
  let release!: () => void;
  h.gate = new Promise<void>((resolve) => (release = resolve));
  h.gatedCalls = 0;
  return () => release();
}

/** Lets pending promise callbacks run, so a paused build reaches its pause point. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  h.store.clear();
  h.store.set('settings:site', { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'], affectedServicesField: 'customfield_10039', requestTypeField: 'customfield_10010', savedAt: 't' }); // explicit site settings (Phase 5.5)
  h.pushes = [];
  h.liveTicket = V1;
  h.gate = null;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('concurrent builds for the same ticket (spec §19.4)', () => {
  it('older build holds the lock and finishes later: newer fingerprint is stored', async () => {
    // 1. Ticket created: build A queued with fingerprint V1.
    await onJiraIssueEvent({ eventType: 'avi:jira:created:issue', issue: { key: 'ITS-1' } });
    const jobA = pushedJob(0);
    const releaseA = pauseFirstBuild();
    const runA = buildTicketBundle(jobA); // A acquires the lock, then pauses at retrieval.
    await settle();
    expect(h.store.has('lock:ITS-1')).toBe(true);

    // 2. Ticket edited while A runs: fingerprint changes, build B queued and owns the status.
    h.liveTicket = V2;
    await onJiraIssueEvent({ eventType: 'avi:jira:updated:issue', issue: { key: 'ITS-1' } });
    const jobB = pushedJob(1);
    expect(status().buildId).toBe(jobB.buildId);

    // 3. B is delivered while A still holds the lock: B is re-queued with a delay, not run.
    await buildTicketBundle(jobB);
    expect(h.pushes).toHaveLength(3);
    expect(h.pushes[2]).toEqual({ body: jobB, delayInSeconds: 30 });
    expect(bundle()).toBeUndefined();

    // 4. The older build A finishes later. Its result is stale and must not be written,
    //    and it must not queue an extra build, because B already covers the change.
    releaseA();
    await runA;
    expect(bundle()).toBeUndefined();
    expect(h.pushes).toHaveLength(3);
    expect(h.store.has('lock:ITS-1')).toBe(false);

    // 5. B's retry runs and writes the bundle for the newer fingerprint.
    await buildTicketBundle(pushedJob(2));
    expect(bundle()!.ticketFingerprint).toBe(ticketFingerprint(V2));
    expect(bundle()!.buildId).toBe(jobB.buildId);
    expect(status()).toMatchObject({ buildId: jobB.buildId, status: 'complete' });
    expect(h.store.has('lock:ITS-1')).toBe(false);
  });

  it('older build outlives its lease, newer build writes first: older never overwrites it', async () => {
    // 1. Build A starts with V1 and stalls past its lease (for example a very slow source).
    await onJiraIssueEvent({ eventType: 'avi:jira:created:issue', issue: { key: 'ITS-1' } });
    const jobA = pushedJob(0);
    const releaseA = pauseFirstBuild();
    const runA = buildTicketBundle(jobA);
    await settle();

    // 2. The ticket changes; build B is queued.
    h.liveTicket = V2;
    await onJiraIssueEvent({ eventType: 'avi:jira:updated:issue', issue: { key: 'ITS-1' } });
    const jobB = pushedJob(1);

    // 3. A's lease expires. B takes over the expired lock and completes first.
    vi.setSystemTime(new Date(T0.getTime() + (LOCK_LEASE_SECONDS + 5) * 1000));
    await buildTicketBundle(jobB);
    expect(bundle()!.ticketFingerprint).toBe(ticketFingerprint(V2));
    expect(status()).toMatchObject({ buildId: jobB.buildId, status: 'complete' });

    // 4. The older build A finally finishes. It must not overwrite B's newer bundle.
    releaseA();
    await runA;
    expect(bundle()!.ticketFingerprint).toBe(ticketFingerprint(V2));
    expect(bundle()!.buildId).toBe(jobB.buildId);
    expect(status()).toMatchObject({ buildId: jobB.buildId, status: 'complete' });
    expect(h.pushes).toHaveLength(2); // No extra builds were queued.
  });

  it('older build outlives its lease with an unchanged ticket: the lock guard stops its write', async () => {
    // Same fingerprint for both builds isolates the lock and status guards from supersession.
    await onJiraIssueEvent({ eventType: 'avi:jira:created:issue', issue: { key: 'ITS-1' } });
    const jobA = pushedJob(0);
    const releaseA = pauseFirstBuild();
    const runA = buildTicketBundle(jobA);
    await settle();

    await onJiraIssueEvent({ eventType: 'avi:jira:updated:issue', issue: { key: 'ITS-1' } });
    const jobB = pushedJob(1);
    vi.setSystemTime(new Date(T0.getTime() + (LOCK_LEASE_SECONDS + 5) * 1000));

    // B takes over the expired lock and pauses too, still holding its fresh lease.
    const releaseB = (() => {
      let release!: () => void;
      h.gate = new Promise<void>((resolve) => (release = resolve));
      h.gatedCalls = 0;
      return () => release();
    })();
    const runB = buildTicketBundle(jobB);
    await settle();

    // A resumes while B holds the lock: A must discard its result.
    releaseA();
    await runA;
    expect(bundle()).toBeUndefined();
    expect((h.store.get('lock:ITS-1') as { buildId: string }).buildId).toBe(jobB.buildId);

    // B finishes and writes.
    releaseB();
    await runB;
    expect(bundle()!.buildId).toBe(jobB.buildId);
    expect(status()).toMatchObject({ buildId: jobB.buildId, status: 'complete' });
  });

  it('a stalled copy of a build cannot write or release the lock of its redelivered copy', async () => {
    // Copy 1 of build A stalls past its lease. Forge redelivers A; copy 2 takes over the expired
    // lock and pauses. Copy 1 must neither write nor release copy 2's lock, even though both
    // copies share the same build ID. Each acquisition has its own owner token for this reason.
    await onJiraIssueEvent({ eventType: 'avi:jira:created:issue', issue: { key: 'ITS-1' } });
    const jobA = pushedJob(0);
    const releaseCopy1 = pauseFirstBuild();
    const copy1 = buildTicketBundle(jobA);
    await settle();

    vi.setSystemTime(new Date(T0.getTime() + (LOCK_LEASE_SECONDS + 5) * 1000));
    let releaseCopy2!: () => void;
    h.gate = new Promise<void>((resolve) => (releaseCopy2 = resolve));
    h.gatedCalls = 0;
    const copy2 = buildTicketBundle(jobA);
    await settle();
    const copy2Lock = h.store.get('lock:ITS-1') as { ownerToken: string };

    releaseCopy1();
    await copy1;
    expect(bundle()).toBeUndefined(); // copy 1 did not write
    expect((h.store.get('lock:ITS-1') as { ownerToken: string }).ownerToken).toBe(copy2Lock.ownerToken); // nor release

    releaseCopy2();
    await copy2;
    expect(status()).toMatchObject({ buildId: jobA.buildId, status: 'complete' });
    expect(h.store.has('lock:ITS-1')).toBe(false);
  });

  it('duplicate delivery of the same build while it runs: only one copy builds', async () => {
    await onJiraIssueEvent({ eventType: 'avi:jira:created:issue', issue: { key: 'ITS-1' } });
    const jobA = pushedJob(0);
    const release = pauseFirstBuild();
    const first = buildTicketBundle(jobA);
    await settle();

    // Forge delivers the same event again while the first copy runs.
    await buildTicketBundle(jobA);
    expect(h.pushes[1]).toEqual({ body: jobA, delayInSeconds: 30 }); // deferred, not run in parallel

    release();
    await first;
    expect(status()).toMatchObject({ buildId: jobA.buildId, status: 'complete' });

    // The deferred copy is a no-op once the build is complete.
    const before = JSON.stringify(bundle());
    await buildTicketBundle(pushedJob(1));
    expect(JSON.stringify(bundle())).toBe(before);
  });
});
