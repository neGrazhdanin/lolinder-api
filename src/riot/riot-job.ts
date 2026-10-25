import { DelayedError, type Job, UnrecoverableError } from 'bullmq';
import { RiotApiError, RiotRateLimitedError, RiotSchemaError } from './riot.errors.js';

// A rejected key or a malformed request fails the same way on every retry.
const PERMANENT_STATUSES = new Set([400, 401, 403]);

/** Runs Riot work inside a processor and maps Riot errors onto BullMQ job outcomes. */
export async function runRiotJob<T>(job: Job, token: string | undefined, work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RiotRateLimitedError) {
      // Frees the worker slot; the job comes back without spending a retry attempt.
      await job.moveToDelayed(Date.now() + error.retryInMs, token);
      throw new DelayedError();
    }
    if (
      error instanceof RiotSchemaError ||
      (error instanceof RiotApiError && PERMANENT_STATUSES.has(error.status))
    ) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
}
