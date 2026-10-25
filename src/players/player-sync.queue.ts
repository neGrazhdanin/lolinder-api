import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { JobState, Queue } from 'bullmq';
import {
  FAILED_SYNC_BACKOFF_MS,
  PLAYERS_QUEUE,
  PlayerJob,
  type SyncPlayerData,
  SyncPriority,
  syncJobId,
} from './players.constants.js';

const PENDING_STATES: ReadonlySet<JobState | 'unknown'> = new Set([
  'waiting',
  'prioritized',
  'active',
  'delayed',
]);

/** One sync job per player: repeated requests join it, and a user request can only raise its priority. */
@Injectable()
export class PlayerSyncQueue {
  constructor(@InjectQueue(PLAYERS_QUEUE) private readonly queue: Queue) {}

  async isSyncing(puuid: string): Promise<boolean> {
    const job = await this.queue.getJob(syncJobId(puuid));
    return job !== undefined && PENDING_STATES.has(await job.getState());
  }

  /** Resolves to `false` when nothing is queued: a background request right after a failed sync. */
  async enqueue(puuid: string, priority: SyncPriority): Promise<boolean> {
    const jobId = syncJobId(puuid);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (PENDING_STATES.has(state)) {
        if (state === 'prioritized' && priority < (existing.opts.priority ?? Infinity)) {
          await existing.changePriority({ priority });
        }
        return true;
      }
      const failedRecently =
        state === 'failed' && Date.now() - (existing.finishedOn ?? 0) < FAILED_SYNC_BACKOFF_MS;
      if (failedRecently && priority === SyncPriority.BACKGROUND) {
        return false;
      }
      // Failed jobs are kept for inspection and would make `add` return them instead of a new run.
      await existing.remove();
    }
    const data: SyncPlayerData = { puuid };
    await this.queue.add(PlayerJob.SYNC, data, {
      jobId,
      priority,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: { age: 600 },
    });
    return true;
  }
}
