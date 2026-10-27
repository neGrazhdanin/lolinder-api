import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { RealtimeEmitter } from '../realtime/realtime.emitter.js';
import { runRiotJob } from '../riot/riot-job.js';
import { MatchHistorySync } from './match-history.sync.js';
import {
  MATCHES_CONCURRENCY,
  MATCHES_QUEUE,
  type MatchHistoryJobData,
  MatchJob,
} from './matches.constants.js';

@Processor(MATCHES_QUEUE, { concurrency: MATCHES_CONCURRENCY })
export class MatchesProcessor extends WorkerHost {
  constructor(
    private readonly history: MatchHistorySync,
    private readonly realtime: RealtimeEmitter,
  ) {
    super();
  }

  async process(job: Job<MatchHistoryJobData>, token?: string): Promise<void> {
    const { puuid } = job.data;
    switch (job.name) {
      case MatchJob.SYNC_NEWEST:
        return runRiotJob(job, token, () => this.history.syncNewest(puuid));
      case MatchJob.LOAD_OLDER:
        return runRiotJob(job, token, () => this.history.loadOlder(puuid));
      default:
        throw new UnrecoverableError(`Unknown ${MATCHES_QUEUE} job: ${job.name}`);
    }
  }

  // Clients show a loading list until the event; a job that gave up must still end that state.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<MatchHistoryJobData>): Promise<void> {
    if (await job.isFailed()) {
      this.realtime.playerMatchesUpdated({ puuid: job.data.puuid });
    }
  }
}
