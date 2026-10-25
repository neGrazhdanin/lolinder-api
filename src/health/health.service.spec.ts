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

    let settled = false;
    const result = service.check().finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ postgres: 'up', redis: 'down' });
  });

  it('reuses the result for two seconds', async () => {
    vi.useFakeTimers();
    const ping = vi.fn(async () => 'PONG');
    const service = createService({ queryRaw: async () => [], ping });

    await service.check();
    await service.check();
    expect(ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    await service.check();
    expect(ping).toHaveBeenCalledTimes(2);
  });
});
