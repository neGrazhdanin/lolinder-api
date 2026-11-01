import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { enqueueUniqueJob, isJobPending } from '../infra/queue/unique-job.js';
import {
  FAILED_HISTORY_BACKOFF_MS,
  MATCHES_QUEUE,
  type MatchHistoryJobData,
  MatchJob,
  newestMatchesJobId,
  olderMatchesJobId,
} from './matches.constants.js';

@Injectable()
export class MatchHistoryQueue {
  constructor(@InjectQueue(MATCHES_QUEUE) private readonly queue: Queue) {}

  async pending(puuid: string): Promise<{ newest: boolean; older: boolean }> {
    const [newest, older] = await Promise.all([
      isJobPending(this.queue, newestMatchesJobId(puuid)),
      isJobPending(this.queue, olderMatchesJobId(puuid)),
    ]);
    return { newest, older };
  }

  syncNewest(puuid: string): Promise<boolean> {
    return this.enqueue(MatchJob.SYNC_NEWEST, newestMatchesJobId(puuid), puuid);
  }

  loadOlder(puuid: string): Promise<boolean> {
    return this.enqueue(MatchJob.LOAD_OLDER, olderMatchesJobId(puuid), puuid);
  }

  private enqueue(name: string, jobId: string, puuid: string): Promise<boolean> {
    const data: MatchHistoryJobData = { puuid };
    return enqueueUniqueJob(this.queue, {
      name,
      jobId,
      data,
      // Unlike "Refresh", a list request is not a deliberate retry: without the backoff, the failure
      // event would make the client request the list again and queue the failing job in a loop.
      failedBackoffMs: FAILED_HISTORY_BACKOFF_MS,
      options: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { age: 600 },
      },
    });
  }
}
