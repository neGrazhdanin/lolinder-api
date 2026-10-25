import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
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
        const redis = new Redis(config.get('REDIS_URL', { infer: true }));
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
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
