import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { RealtimeEmitter } from '../realtime/realtime.emitter.js';
import { runRiotJob } from '../riot/riot-job.js';
import { MatchHistorySync } from './match-history.sync.js';
import { MatchTimelineSync } from './match-timeline.sync.js';
import {
  MATCHES_CONCURRENCY,
  MATCHES_QUEUE,
  type MatchHistoryJobData,
  MatchJob,
  type TimelineJobData,
} from './matches.constants.js';

@Processor(MATCHES_QUEUE, { concurrency: MATCHES_CONCURRENCY })
export class MatchesProcessor extends WorkerHost {
  constructor(
    private readonly history: MatchHistorySync,
    private readonly timeline: MatchTimelineSync,
    private readonly realtime: RealtimeEmitter,
  ) {
    super();
  }

  async process(job: Job, token?: string): Promise<void> {
    switch (job.name) {
      case MatchJob.SYNC_NEWEST:
        return runRiotJob(job, token, () =>
          this.history.syncNewest((job.data as MatchHistoryJobData).puuid),
        );
      case MatchJob.LOAD_OLDER:
        return runRiotJob(job, token, () =>
          this.history.loadOlder((job.data as MatchHistoryJobData).puuid),
        );
      case MatchJob.FETCH_TIMELINE:
        return runRiotJob(job, token, () =>
          this.timeline.fetch((job.data as TimelineJobData).matchId),
        );
      default:
        throw new UnrecoverableError(`Unknown ${MATCHES_QUEUE} job: ${job.name}`);
    }
  }

  // Clients show a loading list until the event; a history job that gave up must still end that state.
  @OnWorkerEvent('failed')
  async onFailed(job: Job): Promise<void> {
    const isHistoryJob = job.name === MatchJob.SYNC_NEWEST || job.name === MatchJob.LOAD_OLDER;
    if (isHistoryJob && (await job.isFailed())) {
      this.realtime.playerMatchesUpdated({ puuid: (job.data as MatchHistoryJobData).puuid });
    }
  }
}
