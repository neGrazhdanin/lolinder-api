import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../infra/redis/redis.constants.js';

// Development and Personal key limits, used only until the first response reports the real ones.
const DEFAULT_APP_LIMITS = '20:1,100:120';
// Requests reach Riot with varying latency, so a window that just closed for us may still be open for Riot.
const WINDOW_MARGIN_MS = 100;
const DEFAULT_PAUSE_MS = 1000;
const LIMITS_HEADER = /^\d+:\d+(,\d+:\d+)*$/;

export type RateLimitScope = 'application' | 'method';

// Sliding-window log per scope: a sorted set of request timestamps taken from the Redis clock,
// so every worker process shares one view of the budget.
const ACQUIRE_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local margin = tonumber(ARGV[2])

local wait = math.max(redis.call('PTTL', KEYS[3]), redis.call('PTTL', KEYS[6]), 0)
if wait > 0 then
  return wait
end

local longest = 0
local function check(log, limits)
  for limit, window in string.gmatch(limits, '(%d+):(%d+)') do
    limit = tonumber(limit)
    local windowMs = tonumber(window) * 1000 + margin
    longest = math.max(longest, windowMs)
    local from = '(' .. (now - windowMs)
    local count = redis.call('ZCOUNT', log, from, '+inf')
    if count >= limit then
      local blocker = redis.call('ZRANGEBYSCORE', log, from, '+inf', 'WITHSCORES', 'LIMIT', count - limit, 1)
      wait = math.max(wait, tonumber(blocker[2]) + windowMs - now, 1)
    end
  end
end

check(KEYS[1], redis.call('GET', KEYS[2]) or ARGV[1])
check(KEYS[4], redis.call('GET', KEYS[5]) or '')
if wait > 0 then
  return wait
end

for _, log in ipairs({ KEYS[1], KEYS[4] }) do
  redis.call('ZREMRANGEBYSCORE', log, '-inf', now - longest)
  redis.call('ZADD', log, now, ARGV[3])
  redis.call('PEXPIRE', log, longest)
end
return 0
`;

/** Riot rate limits per routing value (app) and per routing value and endpoint (method), shared through Redis. */
@Injectable()
export class RiotRateLimiter {
  private readonly logger = new Logger(RiotRateLimiter.name);
  private readonly storedLimits = new Map<string, string>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Waits until both the app and the method windows of `host` have room, then counts the request. */
  async acquire(host: string, endpoint: string): Promise<void> {
    for (;;) {
      const waitMs = await this.tryAcquire(host, endpoint);
      if (waitMs === 0) {
        return;
      }
      await sleep(waitMs);
    }
  }

  /** Counts the request and returns 0, or returns how many milliseconds to wait without counting it. */
  async tryAcquire(host: string, endpoint: string): Promise<number> {
    const app = keysOf(host);
    const method = keysOf(`${host}:${endpoint}`);
    const waitMs = await this.redis.eval(
      ACQUIRE_SCRIPT,
      6,
      app.log,
      app.limits,
      app.pause,
      method.log,
      method.limits,
      method.pause,
      DEFAULT_APP_LIMITS,
      WINDOW_MARGIN_MS,
      randomUUID(),
    );
    return Number(waitMs);
  }

  /** Stores the limits Riot reports in `X-App-Rate-Limit` and `X-Method-Rate-Limit`. */
  async recordLimits(host: string, endpoint: string, headers: Headers): Promise<void> {
    await this.storeLimits(keysOf(host).limits, headers.get('x-app-rate-limit'));
    await this.storeLimits(
      keysOf(`${host}:${endpoint}`).limits,
      headers.get('x-method-rate-limit'),
    );
  }

  async pause(
    host: string,
    endpoint: string,
    scope: RateLimitScope,
    retryAfterSeconds: number | undefined,
  ): Promise<void> {
    const pauseMs = retryAfterSeconds === undefined ? DEFAULT_PAUSE_MS : retryAfterSeconds * 1000;
    const key = scope === 'application' ? keysOf(host).pause : keysOf(`${host}:${endpoint}`).pause;
    this.logger.warn(
      `Riot rate limit hit on ${host} ${endpoint} (${scope}), pausing ${pauseMs} ms`,
    );
    await this.redis.set(key, '1', 'PX', pauseMs);
  }

  private async storeLimits(key: string, value: string | null): Promise<void> {
    if (value === null || !LIMITS_HEADER.test(value) || this.storedLimits.get(key) === value) {
      return;
    }
    await this.redis.set(key, value);
    this.storedLimits.set(key, value);
  }
}

function keysOf(scope: string) {
  const prefix = `riot:rate:${scope}`;
  return { log: `${prefix}:log`, limits: `${prefix}:limits`, pause: `${prefix}:pause` };
}
