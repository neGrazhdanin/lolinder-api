import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RiotModule } from '../riot/riot.module.js';
import { PLAYERS_QUEUE } from './players.constants.js';
import { PlayersProcessor } from './players.processor.js';

@Module({
  imports: [BullModule.registerQueue({ name: PLAYERS_QUEUE }), RiotModule],
  providers: [PlayersProcessor],
})
export class PlayersWorkerModule {}
