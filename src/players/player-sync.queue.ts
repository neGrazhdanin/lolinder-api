import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { enqueueUniqueJob, isJobPending } from '../infra/queue/unique-job.js';
import {
  FAILED_SYNC_BACKOFF_MS,
  PLAYERS_QUEUE,
  PlayerJob,
  type SyncPlayerData,
  SyncPriority,
  syncJobId,
} from './players.constants.js';

/** One sync job per player: repeated requests join it, and a user request can only raise its priority. */
@Injectable()
export class PlayerSyncQueue {
  constructor(@InjectQueue(PLAYERS_QUEUE) private readonly queue: Queue) {}

  isSyncing(puuid: string): Promise<boolean> {
    return isJobPending(this.queue, syncJobId(puuid));
  }

  /** Resolves to `false` when nothing is queued: a background request right after a failed sync. */
  enqueue(puuid: string, priority: SyncPriority): Promise<boolean> {
    const data: SyncPlayerData = { puuid };
    return enqueueUniqueJob(this.queue, {
      name: PlayerJob.SYNC,
      jobId: syncJobId(puuid),
      data,
      priority,
      // "Refresh" retries at once; page views wait out the backoff.
      failedBackoffMs: priority === SyncPriority.BACKGROUND ? FAILED_SYNC_BACKOFF_MS : undefined,
      options: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { age: 600 },
      },
    });
  }
}
