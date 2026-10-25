import { DelayedError, type Job, UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { RiotApiError, RiotRateLimitedError, RiotSchemaError } from './riot.errors.js';
import { runRiotJob } from './riot-job.js';

function fakeJob() {
  return { moveToDelayed: vi.fn(async () => {}) };
}

describe('runRiotJob', () => {
  it('returns the result of the work', async () => {
    expect(await runRiotJob(fakeJob() as unknown as Job, 'token', async () => 42)).toBe(42);
  });

  it('delays the job for the limiter wait instead of failing it', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const job = fakeJob();
    const work = async () => {
      throw new RiotRateLimitedError('europe', 'match-v5.getMatch', 30_000);
    };

    await expect(runRiotJob(job as unknown as Job, 'token', work)).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.moveToDelayed).toHaveBeenCalledWith(1_030_000, 'token');
    vi.useRealTimers();
  });

  it('fails a schema mismatch for good', async () => {
    const work = async () => {
      throw new RiotSchemaError('match-v5.getMatch', new Error('bad'));
    };
    await expect(runRiotJob(fakeJob() as unknown as Job, 'token', work)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it.each([400, 401, 403])('fails a %i for good', async (status) => {
    const work = async () => {
      throw new RiotApiError('match-v5.getMatch', status);
    };
    await expect(runRiotJob(fakeJob() as unknown as Job, 'token', work)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('leaves other errors to the regular retry policy', async () => {
    const error = new RiotApiError('match-v5.getMatch', 503);
    await expect(
      runRiotJob(fakeJob() as unknown as Job, 'token', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
