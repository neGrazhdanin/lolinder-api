import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RealtimeEmitterModule } from '../realtime/realtime-emitter.module.js';
import { RiotModule } from '../riot/riot.module.js';
import { PlayerSyncQueue } from './player-sync.queue.js';
import { PlayerSyncService } from './player-sync.service.js';
import { PLAYERS_QUEUE } from './players.constants.js';
import { PlayersProcessor } from './players.processor.js';

@Module({
  imports: [BullModule.registerQueue({ name: PLAYERS_QUEUE }), RiotModule, RealtimeEmitterModule],
  providers: [PlayersProcessor, PlayerSyncService, PlayerSyncQueue],
})
export class PlayersWorkerModule {}
