import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { PlayerJobEvents } from './player-job-events.js';
import { PlayerSyncQueue } from './player-sync.queue.js';
import { PLAYERS_QUEUE } from './players.constants.js';
import { PlayersController } from './players.controller.js';
import { PlayersService } from './players.service.js';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: PLAYERS_QUEUE,
      inject: [ConfigService],
      // Without the offline queue, enqueueing fails at once while Redis is down instead of hanging the request.
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }), enableOfflineQueue: false },
      }),
    }),
  ],
  controllers: [PlayersController],
  providers: [PlayersService, PlayerJobEvents, PlayerSyncQueue],
})
export class PlayersModule {}
