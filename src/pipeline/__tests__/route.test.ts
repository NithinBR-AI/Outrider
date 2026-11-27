// Routing and consumer tests (spec §6.4, §19.2).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildTicketBundle = vi.hoisted(() => vi.fn());
const runReconcile = vi.hoisted(() => vi.fn());
vi.mock('../buildTicket', () => ({ buildTicketBundle }));
vi.mock('../reconcile', () => ({ runReconcile }));

import { handleJob, isBuildJob } from '../route';
import { buildJob } from '../jobs';
import { BuildJob } from '../../domain/types';

const ticketJob: BuildJob = { kind: 'jira-ticket', ticketKey: 'ITS-1', buildId: 'b1', requestedAt: 't', actor: { source: 'jira-event' } };
const pageJob: BuildJob = { kind: 'confluence-page', contentId: '4194312', operation: 'upsert', buildId: 'b2', requestedAt: 't', actor: { source: 'confluence-event' } };

beforeEach(() => {
  buildTicketBundle.mockReset();
  runReconcile.mockReset().mockResolvedValue({});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('isBuildJob', () => {
  it('accepts valid jira-ticket and confluence-page jobs', () => {
    expect(isBuildJob(ticketJob)).toBe(true);
    expect(isBuildJob(pageJob)).toBe(true);
    expect(isBuildJob({ ...pageJob, operation: 'delete' })).toBe(true);
    expect(isBuildJob({ kind: 'reconcile', buildId: 'r', requestedAt: 't', actor: { source: 'reconcile' } })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'ITS-1'],
    ['an unknown kind', { ...ticketJob, kind: 'other' }],
    ['a ticket job without a key', { ...ticketJob, ticketKey: undefined }],
    ['a page job with a bad operation', { ...pageJob, operation: 'move' }],
    ['a page job without a content ID', { ...pageJob, contentId: 12 }],
    ['a job without a build ID', { ...ticketJob, buildId: undefined }],
    ['a job without an actor', { ...ticketJob, actor: undefined }],
  ])('rejects %s', (_name, value) => {
    expect(isBuildJob(value)).toBe(false);
  });
});

describe('handleJob', () => {
  it('sends jira-ticket jobs to the ticket builder', async () => {
    await handleJob(ticketJob);
    expect(buildTicketBundle).toHaveBeenCalledWith(ticketJob);
  });

  it('sends reconcile jobs to the reconciliation run', async () => {
    const job: BuildJob = { kind: 'reconcile', buildId: 'r', requestedAt: 't', actor: { source: 'reconcile' } };
    await expect(handleJob(job)).resolves.toBeUndefined();
    expect(runReconcile).toHaveBeenCalledWith(job);
    expect(buildTicketBundle).not.toHaveBeenCalled();
  });

  it('never sends a Confluence page job to Jira ticket retrieval', async () => {
    await handleJob(pageJob);
    await handleJob({ ...pageJob, operation: 'delete' });
    expect(buildTicketBundle).not.toHaveBeenCalled();
  });
});

describe('buildJob consumer', () => {
  it('routes a valid queue body', async () => {
    await buildJob({ body: ticketJob, queueName: 'outrider-build-queue', jobId: 'j1', eventId: 'e1' });
    expect(buildTicketBundle).toHaveBeenCalledWith(ticketJob);
  });

  it('drops a malformed body without throwing, so the queue does not retry it', async () => {
    await expect(buildJob({ body: { kind: 'jira-ticket' }, queueName: 'q', jobId: 'j2', eventId: 'e2' })).resolves.toBeUndefined();
    expect(buildTicketBundle).not.toHaveBeenCalled();
  });
});
