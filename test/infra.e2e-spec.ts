import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { type INestApplicationContext, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CoreModule } from '../src/core/core.module.js';
import { InfraModule } from '../src/infra/infra.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { CacheService } from '../src/infra/redis/cache.service.js';
import { REDIS } from '../src/infra/redis/redis.constants.js';

const PROBE_QUEUE = 'infra-probe';

@Processor(PROBE_QUEUE)
class ProbeProcessor extends WorkerHost {
  async process(job: Job<{ value: number }>): Promise<number> {
    return job.data.value * 2;
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
      data: { puuid: 'infra-puuid', gameName: 'Faker', tagLine: 'KR1', platform: 'kr' },
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
});
