import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RiotRateLimitedError } from '../src/riot/riot.errors.js';
import { RiotRateLimiter } from '../src/riot/riot-rate-limiter.js';

const connections: Redis[] = [];

function createLimiter(): RiotRateLimiter {
  const redis = new Redis(process.env.REDIS_URL ?? '');
  connections.push(redis);
  return new RiotRateLimiter(redis);
}

function limitHeaders(app: string, method = '1000:10'): Headers {
  return new Headers({ 'X-App-Rate-Limit': app, 'X-Method-Rate-Limit': method });
}

async function acquireTimes(
  limiter: RiotRateLimiter,
  host: string,
  endpoint: string,
  times: number,
) {
  const waits: number[] = [];
  for (let i = 0; i < times; i++) {
    waits.push(await limiter.tryAcquire(host, endpoint));
  }
  return waits;
}

describe('RiotRateLimiter (e2e)', () => {
  const endpoint = 'summoner-v4.getByPuuid';

  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterAll(async () => {
    await Promise.all(connections.map((redis) => redis.quit()));
  });

  it('applies Development key limits until Riot reports its own', async () => {
    const host = `euw1-${randomUUID()}`;
    const waits = await acquireTimes(createLimiter(), host, endpoint, 21);

    expect(waits.slice(0, 20)).toEqual(Array(20).fill(0));
    expect(waits[20]).toBeGreaterThan(0);
  });

  it('blocks once a window is full and reports when it reopens', async () => {
    const limiter = createLimiter();
    const host = `euw1-${randomUUID()}`;
    await limiter.recordLimits(host, endpoint, limitHeaders('2:1,100:120'));

    const waits = await acquireTimes(limiter, host, endpoint, 3);

    expect(waits.slice(0, 2)).toEqual([0, 0]);
    expect(waits[2]).toBeGreaterThan(900);
    expect(waits[2]).toBeLessThanOrEqual(1100);
  });

  it('keeps method limits separate per endpoint', async () => {
    const limiter = createLimiter();
    const host = `kr-${randomUUID()}`;
    await limiter.recordLimits(host, 'league-v4.getEntriesByPuuid', limitHeaders('100:1', '1:10'));

    const [first, second] = await acquireTimes(limiter, host, 'league-v4.getEntriesByPuuid', 2);
    expect(first).toBe(0);
    expect(second).toBeGreaterThan(9000);
    expect(await limiter.tryAcquire(host, endpoint)).toBe(0);
  });

  it('shares one budget between processes', async () => {
    const first = createLimiter();
    const second = createLimiter();
    const host = `europe-${randomUUID()}`;
    await first.recordLimits(host, endpoint, limitHeaders('5:10'));

    const waits = await Promise.all(
      Array.from({ length: 10 }, (_, i) => (i % 2 ? first : second).tryAcquire(host, endpoint)),
    );

    expect(waits.filter((wait) => wait === 0)).toHaveLength(5);
  });

  it('pauses the whole routing value after an application 429', async () => {
    const limiter = createLimiter();
    const host = `na1-${randomUUID()}`;
    await limiter.pause(host, endpoint, 'application', 2);

    const wait = await limiter.tryAcquire(host, 'league-v4.getEntriesByPuuid');
    expect(wait).toBeGreaterThan(1900);
    expect(wait).toBeLessThanOrEqual(2000);
  });

  it('pauses only the endpoint after a method 429', async () => {
    const limiter = createLimiter();
    const host = `na1-${randomUUID()}`;
    await limiter.pause(host, endpoint, 'method', 2);

    expect(await limiter.tryAcquire(host, endpoint)).toBeGreaterThan(1900);
    expect(await limiter.tryAcquire(host, 'league-v4.getEntriesByPuuid')).toBe(0);
  });

  it('acquire waits for the window to reopen', async () => {
    const limiter = createLimiter();
    const host = `br1-${randomUUID()}`;
    await limiter.recordLimits(host, endpoint, limitHeaders('1:1'));

    const startedAt = performance.now();
    await limiter.acquire(host, endpoint);
    await limiter.acquire(host, endpoint);

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(1000);
  });

  it('blocks on the longer window too', async () => {
    const limiter = createLimiter();
    const host = `euw1-${randomUUID()}`;
    await limiter.recordLimits(host, endpoint, limitHeaders('100:1,3:120'));

    const waits = await acquireTimes(limiter, host, endpoint, 4);
    expect(waits.slice(0, 3)).toEqual([0, 0, 0]);
    expect(waits[3]).toBeGreaterThan(119_000);
  });

  it('ignores malformed and zero limits', async () => {
    const limiter = createLimiter();
    const host = `euw1-${randomUUID()}`;
    await limiter.recordLimits(host, endpoint, limitHeaders('0:1', 'many'));

    expect(await acquireTimes(limiter, host, endpoint, 20)).toEqual(Array(20).fill(0));
    expect(await limiter.tryAcquire(host, endpoint)).toBeGreaterThan(0);
  });

  it('replaces stored limits when Riot reports new ones', async () => {
    const limiter = createLimiter();
    const host = `euw1-${randomUUID()}`;
    await limiter.recordLimits(host, endpoint, limitHeaders('1:10'));
    await limiter.recordLimits(host, endpoint, limitHeaders('2:10'));

    expect(await acquireTimes(limiter, host, endpoint, 3)).toEqual([0, 0, expect.any(Number)]);
    expect(await limiter.tryAcquire(host, endpoint)).toBeGreaterThan(9000);
  });

  it('pauses for one second when Retry-After is missing', async () => {
    const limiter = createLimiter();
    const host = `na1-${randomUUID()}`;
    await limiter.pause(host, endpoint, 'application', undefined);

    const wait = await limiter.tryAcquire(host, endpoint);
    expect(wait).toBeGreaterThan(900);
    expect(wait).toBeLessThanOrEqual(1000);
  });

  it('never shortens a pause that is already longer', async () => {
    const limiter = createLimiter();
    const host = `na1-${randomUUID()}`;
    await limiter.pause(host, endpoint, 'application', 60);
    await limiter.pause(host, endpoint, 'application', 1);

    expect(await limiter.tryAcquire(host, endpoint)).toBeGreaterThan(59_000);
  });

  it('hands long waits back to the caller instead of sleeping', async () => {
    const limiter = createLimiter();
    const host = `na1-${randomUUID()}`;
    await limiter.pause(host, endpoint, 'method', 30);

    const error = await limiter.acquire(host, endpoint).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RiotRateLimitedError);
    expect((error as RiotRateLimitedError).retryInMs).toBeGreaterThan(29_000);
  });
});
