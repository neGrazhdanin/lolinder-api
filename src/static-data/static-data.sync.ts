import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataDragonClient } from './data-dragon.client.js';
import { STATIC_DATA_QUEUE } from './static-data.constants.js';
import { STATIC_LOCALES, type StaticDataSets, type StaticLocale } from './static-data.schemas.js';
import { StaticDataService } from './static-data.service.js';

const SYNC_INTERVAL_MS = 60 * 60 * 1000;

export interface StaticDataSyncResult {
  version: string;
  imported: boolean;
}

@Processor(STATIC_DATA_QUEUE)
export class StaticDataSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(StaticDataSyncProcessor.name);

  constructor(
    private readonly dataDragon: DataDragonClient,
    private readonly staticData: StaticDataService,
  ) {
    super();
  }

  async process(): Promise<StaticDataSyncResult> {
    const version = await this.dataDragon.latestVersion();
    if (await this.staticData.hasVersion(version)) {
      return { version, imported: false };
    }

    const entries = await Promise.all(
      STATIC_LOCALES.map(
        async (locale) => [locale, await this.dataDragon.fetchSets(version, locale)] as const,
      ),
    );
    await this.staticData.saveVersion(
      version,
      Object.fromEntries(entries) as Record<StaticLocale, StaticDataSets>,
    );
    this.logger.log(`Imported Data Dragon ${version}`);
    return { version, imported: true };
  }
}

/** Upserting is idempotent across restarts; the first run starts right away. */
@Injectable()
export class StaticDataSyncScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(STATIC_DATA_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'static-data-sync',
      { every: SYNC_INTERVAL_MS },
      {
        name: 'sync',
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 50,
          removeOnFail: 100,
        },
      },
    );
  }
}
