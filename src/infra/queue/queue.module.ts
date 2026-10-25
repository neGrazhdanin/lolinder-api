import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import type { Env } from '../../config/env.js';
import { WorkerShutdown } from './worker-shutdown.js';

@Module({
  imports: [
    DiscoveryModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
      }),
    }),
  ],
  providers: [WorkerShutdown],
})
export class QueueModule {}
