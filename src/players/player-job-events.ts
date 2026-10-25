import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import type { Env } from '../config/env.js';
import { PLAYERS_QUEUE } from './players.constants.js';

/** Completion events of player jobs, so an API request can wait briefly for the worker. */
@Injectable()
export class PlayerJobEvents implements OnApplicationShutdown {
  readonly queueEvents: QueueEvents;

  constructor(config: ConfigService<Env, true>) {
    this.queueEvents = new QueueEvents(PLAYERS_QUEUE, {
      connection: { url: config.get('REDIS_URL', { infer: true }) },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queueEvents.close();
  }
}
