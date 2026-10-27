import type { JobState, JobsOptions, Queue } from 'bullmq';

const PENDING_STATES: ReadonlySet<JobState | 'unknown'> = new Set([
  'waiting',
  'prioritized',
  'active',
  'delayed',
]);

export interface UniqueJob {
  name: string;
  jobId: string;
  data: object;
  priority?: number;
  failedBackoffMs?: number;
  options: Omit<JobsOptions, 'jobId' | 'priority'>;
}

export async function isJobPending(queue: Queue, jobId: string): Promise<boolean> {
  const job = await queue.getJob(jobId);
  return job !== undefined && PENDING_STATES.has(await job.getState());
}

/** One job per ID. Resolves to `false` when the last run failed within `failedBackoffMs`. */
export async function enqueueUniqueJob(queue: Queue, job: UniqueJob): Promise<boolean> {
  const existing = await queue.getJob(job.jobId);
  if (existing) {
    const state = await existing.getState();
    if (PENDING_STATES.has(state)) {
      if (
        state === 'prioritized' &&
        job.priority !== undefined &&
        job.priority < (existing.opts.priority ?? Infinity)
      ) {
        await existing.changePriority({ priority: job.priority });
      }
      return true;
    }
    const failedRecently =
      state === 'failed' &&
      job.failedBackoffMs !== undefined &&
      Date.now() - (existing.finishedOn ?? 0) < job.failedBackoffMs;
    if (failedRecently) {
      return false;
    }
    // Finished jobs that are kept would make `add` return them instead of starting a new run.
    await existing.remove();
  }
  await queue.add(job.name, job.data, { ...job.options, jobId: job.jobId, priority: job.priority });
  return true;
}
