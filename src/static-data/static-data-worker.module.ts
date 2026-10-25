import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DataDragonClient } from './data-dragon.client.js';
import { STATIC_DATA_QUEUE } from './static-data.constants.js';
import { StaticDataService } from './static-data.service.js';
import { StaticDataSyncProcessor, StaticDataSyncScheduler } from './static-data.sync.js';

@Module({
  imports: [BullModule.registerQueue({ name: STATIC_DATA_QUEUE })],
  providers: [
    DataDragonClient,
    StaticDataService,
    StaticDataSyncProcessor,
    StaticDataSyncScheduler,
  ],
})
export class StaticDataWorkerModule {}
