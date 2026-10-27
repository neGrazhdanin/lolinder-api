import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RealtimeEmitterModule } from '../realtime/realtime-emitter.module.js';
import { RiotModule } from '../riot/riot.module.js';
import { MatchHistorySync } from './match-history.sync.js';
import { MATCHES_QUEUE } from './matches.constants.js';
import { MatchesProcessor } from './matches.processor.js';

@Module({
  imports: [BullModule.registerQueue({ name: MATCHES_QUEUE }), RiotModule, RealtimeEmitterModule],
  providers: [MatchesProcessor, MatchHistorySync],
})
export class MatchesWorkerModule {}
