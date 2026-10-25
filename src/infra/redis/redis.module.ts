import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';
import { CacheService } from './cache.service.js';
import { REDIS } from './redis.constants.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const logger = new Logger('Redis');
        const redis = new Redis(config.get('REDIS_URL', { infer: true }), {
          // The default of 20 retries keeps a request hanging for tens of seconds during an outage.
          maxRetriesPerRequest: 2,
        });
        redis.on('error', (error: NodeJS.ErrnoException) =>
          // localhost resolves to IPv4 and IPv6; refusing both yields an AggregateError with an empty message.
          logger.warn(`Redis connection error: ${error.code ?? error.message}`),
        );
        return redis;
      },
    },
    CacheService,
  ],
  exports: [REDIS, CacheService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
