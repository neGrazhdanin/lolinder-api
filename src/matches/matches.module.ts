import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { MatchHistoryQueue } from './match-history.queue.js';
import { MATCHES_QUEUE } from './matches.constants.js';
import { MatchesController } from './matches.controller.js';
import { MatchesService } from './matches.service.js';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: MATCHES_QUEUE,
      inject: [ConfigService],
      // Without the offline queue, enqueueing fails at once while Redis is down instead of hanging the request.
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }), enableOfflineQueue: false },
      }),
    }),
  ],
  controllers: [MatchesController],
  providers: [MatchesService, MatchHistoryQueue],
})
export class MatchesModule {}
