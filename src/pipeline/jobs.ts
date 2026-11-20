// Queue consumer entry point (manifest: consumer outrider-build-consumer -> function buildJob).
// Forge may deliver an event more than once; every job handler must be safe to re-run.
import { AsyncEvent } from '@forge/events';
import { handleJob, isBuildJob } from './route';

export async function buildJob(event: AsyncEvent): Promise<void> {
  if (!isBuildJob(event.body)) {
    // A malformed body can never succeed, so drop it instead of letting the queue retry it.
    console.error(`dropped malformed job ${event.jobId}`);
    return;
  }
  await handleJob(event.body);
}
