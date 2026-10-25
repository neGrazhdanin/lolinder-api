import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../infra/prisma/prisma.service.js';
import { HealthService } from './health.service.js';

function createService(deps: { queryRaw: () => Promise<unknown>; ping: () => Promise<unknown> }) {
  const prisma = { $queryRaw: vi.fn(deps.queryRaw) } as unknown as PrismaService;
  const redis = { ping: vi.fn(deps.ping) } as unknown as Redis;
  return new HealthService(prisma, redis);
}

describe('HealthService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports both dependencies up', async () => {
    const service = createService({
      queryRaw: async () => [{ '?column?': 1 }],
      ping: async () => 'PONG',
    });
    expect(await service.check()).toEqual({ postgres: 'up', redis: 'up' });
  });

  it('reports a failing dependency as down', async () => {
    const service = createService({
      queryRaw: async () => {
        throw new Error('connection refused');
      },
      ping: async () => 'PONG',
    });
    expect(await service.check()).toEqual({ postgres: 'down', redis: 'up' });
  });

  it('reports a hanging dependency as down after the probe timeout', async () => {
    vi.useFakeTimers();
    const service = createService({
      queryRaw: async () => [],
      ping: () => new Promise(() => {}),
    });

    const result = service.check();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ postgres: 'up', redis: 'down' });
  });
});
