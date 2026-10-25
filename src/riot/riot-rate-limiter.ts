import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../infra/redis/redis.constants.js';
import { RiotRateLimitedError } from './riot.errors.js';

// Development and Personal key limits, used only until the first response reports the real ones.
const DEFAULT_APP_LIMITS = '20:1,100:120';
// Requests reach Riot with varying latency, so a window that just closed for us may still be open for Riot.
const WINDOW_MARGIN_MS = 100;
// Longer waits go back to the caller so a BullMQ job can be delayed instead of holding a worker slot.
const MAX_INLINE_WAIT_MS = 2000;
const DEFAULT_PAUSE_MS = 1000;
const LIMITS_HEADER = /^[1-9]\d*:[1-9]\d*(,[1-9]\d*:[1-9]\d*)*$/;

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

// A request still in flight can return a shorter Retry-After than the pause already set.
const PAUSE_SCRIPT = `
if redis.call('PTTL', KEYS[1]) < tonumber(ARGV[1]) then
  redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
end
`;

interface LimiterCommands {
  riotAcquire(...args: (string | number)[]): Promise<number>;
  riotPause(key: string, pauseMs: number): Promise<unknown>;
}

/** Riot rate limits per routing value (app) and per routing value and endpoint (method), shared through Redis. */
@Injectable()
export class RiotRateLimiter {
  private readonly logger = new Logger(RiotRateLimiter.name);
  private readonly commands: LimiterCommands;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    redis.defineCommand('riotAcquire', { numberOfKeys: 6, lua: ACQUIRE_SCRIPT });
    redis.defineCommand('riotPause', { numberOfKeys: 1, lua: PAUSE_SCRIPT });
    this.commands = redis as unknown as LimiterCommands;
  }

  /** Throws `RiotRateLimitedError` instead of sleeping when the wait is longer than a couple of seconds. */
  async acquire(host: string, endpoint: string): Promise<void> {
    for (;;) {
      const waitMs = await this.tryAcquire(host, endpoint);
      if (waitMs === 0) {
        return;
      }
      if (waitMs > MAX_INLINE_WAIT_MS) {
        throw new RiotRateLimitedError(host, endpoint, waitMs);
      }
      await sleep(waitMs);
    }
  }

  /** Counts the request and returns 0, or returns how many milliseconds to wait without counting it. */
  async tryAcquire(host: string, endpoint: string): Promise<number> {
    const { app, method } = keysOf(host, endpoint);
    const waitMs = await this.commands.riotAcquire(
      app.log,
      app.limits,
      app.pause,
      method.log,
      method.limits,
      method.pause,
      DEFAULT_APP_LIMITS,
      WINDOW_MARGIN_MS,
      randomBytes(6).toString('base64url'),
    );
    return Number(waitMs);
  }

  // Written on every response: if Redis loses the keys, the next response restores them.
  async recordLimits(host: string, endpoint: string, headers: Headers): Promise<void> {
    const { app, method } = keysOf(host, endpoint);
    const limits: Record<string, string> = {};
    for (const [key, value] of [
      [app.limits, headers.get('x-app-rate-limit')],
      [method.limits, headers.get('x-method-rate-limit')],
    ] as const) {
      if (value !== null && LIMITS_HEADER.test(value)) {
        limits[key] = value;
      }
    }
    if (Object.keys(limits).length > 0) {
      await this.redis.mset(limits);
    }
  }

  async pause(
    host: string,
    endpoint: string,
    scope: RateLimitScope,
    retryAfterSeconds: number | undefined,
  ): Promise<void> {
    const pauseMs = retryAfterSeconds === undefined ? DEFAULT_PAUSE_MS : retryAfterSeconds * 1000;
    const { app, method } = keysOf(host, endpoint);
    this.logger.warn(
      `Riot rate limit hit on ${host} ${endpoint} (${scope}), pausing ${pauseMs} ms`,
    );
    await this.commands.riotPause(scope === 'application' ? app.pause : method.pause, pauseMs);
  }
}

function keysOf(host: string, endpoint: string) {
  const scope = (prefix: string) => ({
    log: `${prefix}:log`,
    limits: `${prefix}:limits`,
    pause: `${prefix}:pause`,
  });
  return { app: scope(`riot:rate:${host}`), method: scope(`riot:rate:${host}:${endpoint}`) };
}
