import { setTimeout as sleep } from 'node:timers/promises';
import { BullModule, getQueueToken, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { type INestApplicationContext, Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CoreModule } from '../src/core/core.module.js';
import { InfraModule } from '../src/infra/infra.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { CacheService } from '../src/infra/redis/cache.service.js';
import { REDIS } from '../src/infra/redis/redis.constants.js';
import { riotIdKey } from '../src/riot/riot-id.js';

const PROBE_QUEUE = 'infra-probe';

@Processor(PROBE_QUEUE)
class ProbeProcessor extends WorkerHost {
  async process(job: Job<{ value: number }>): Promise<number> {
    return job.data.value * 2;
  }
}

const SHUTDOWN_QUEUE = 'infra-shutdown-probe';

@Processor(SHUTDOWN_QUEUE)
class ShutdownProbeProcessor extends WorkerHost {
  static readonly started = Promise.withResolvers<void>();
  static readonly release = Promise.withResolvers<void>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    super();
  }

  async process(): Promise<void> {
    ShutdownProbeProcessor.started.resolve();
    await ShutdownProbeProcessor.release.promise;
    await this.prisma.$queryRaw`select 1`;
    await this.redis.set('infra:shutdown-probe', 'finished');
  }
}

@Injectable()
class ProbeProducer {
  constructor(@InjectQueue(PROBE_QUEUE) readonly queue: Queue) {}
}

describe('infra (e2e)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule, InfraModule, BullModule.registerQueue({ name: PROBE_QUEUE })],
      providers: [ProbeProcessor, ProbeProducer],
    }).compile();
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reads and writes Postgres through PrismaService', async () => {
    const prisma = app.get(PrismaService);
    await prisma.riotAccount.create({
      data: {
        puuid: 'infra-puuid',
        gameName: 'Faker',
        tagLine: 'KR1',
        riotIdKey: riotIdKey('Faker', 'KR1'),
        platform: 'kr',
      },
    });
    const account = await prisma.riotAccount.findUnique({ where: { puuid: 'infra-puuid' } });
    expect(account).toMatchObject({ gameName: 'Faker', tagLine: 'KR1' });
  });

  describe('CacheService', () => {
    const schema = z.object({ lp: z.number(), takenAt: z.coerce.date() });

    it('round-trips JSON through the schema with a TTL', async () => {
      const cache = app.get(CacheService);
      const takenAt = new Date('2026-10-20T12:00:00.000Z');
      await cache.set('profile:1', { lp: 75, takenAt }, 60);

      expect(await cache.get('profile:1', schema)).toEqual({ lp: 75, takenAt });
      const ttl = await app.get<Redis>(REDIS).ttl('cache:profile:1');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('returns null on a miss', async () => {
      expect(await app.get(CacheService).get('profile:missing', schema)).toBeNull();
    });

    it('treats entries that no longer match the schema as a miss and deletes them', async () => {
      const cache = app.get(CacheService);
      const redis = app.get<Redis>(REDIS);
      await cache.set('profile:stale', { lp: 'seventy' }, 60);
      await redis.set('cache:profile:broken', '{not json', 'EX', 60);

      expect(await cache.get('profile:stale', schema)).toBeNull();
      expect(await cache.get('profile:broken', schema)).toBeNull();
      expect(await redis.exists('cache:profile:stale', 'cache:profile:broken')).toBe(0);
    });
  });

  it('runs BullMQ jobs through a registered processor', async () => {
    const { queue } = app.get(ProbeProducer);
    const job = await queue.add('double', { value: 21 });

    await expect.poll(async () => (await queue.getJob(job.id ?? ''))?.returnvalue).toBe(42);
  });

  it('closes the Redis client on shutdown', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule, InfraModule],
    }).compile();
    const context = await moduleRef.init();
    const redis = context.get<Redis>(REDIS);
    await redis.ping();

    await context.close();
    await expect.poll(() => redis.status).toBe('end');
  });

  it('lets an active job finish with Redis and Prisma before closing them', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule, InfraModule, BullModule.registerQueue({ name: SHUTDOWN_QUEUE })],
      providers: [ShutdownProbeProcessor],
    }).compile();
    const context = await moduleRef.init();
    await context.get<Queue>(getQueueToken(SHUTDOWN_QUEUE)).add('probe', {});
    await ShutdownProbeProcessor.started.promise;

    const closing = context.close();
    await sleep(100);
    ShutdownProbeProcessor.release.resolve();
    await closing;

    const redis = new Redis(process.env.REDIS_URL ?? '');
    expect(await redis.get('infra:shutdown-probe')).toBe('finished');
    await redis.quit();
  });
});
