import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { enqueueUniqueJob } from '../infra/queue/unique-job.js';
import {
  FAILED_HISTORY_BACKOFF_MS,
  MATCHES_QUEUE,
  MatchJob,
  type TimelineJobData,
  timelineJobId,
} from './matches.constants.js';

@Injectable()
export class MatchTimelineQueue {
  constructor(@InjectQueue(MATCHES_QUEUE) private readonly queue: Queue) {}

  fetch(matchId: string): Promise<boolean> {
    const data: TimelineJobData = { matchId };
    return enqueueUniqueJob(this.queue, {
      name: MatchJob.FETCH_TIMELINE,
      jobId: timelineJobId(matchId),
      data,
      // Clients retry every few seconds; without the backoff each retry would requeue a failing job.
      failedBackoffMs: FAILED_HISTORY_BACKOFF_MS,
      options: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: { age: 600 },
      },
    });
  }
}
