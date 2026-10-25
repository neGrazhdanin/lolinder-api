import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { REDIS } from './redis.constants.js';

const KEY_PREFIX = 'cache:';

@Injectable()
export class CacheService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Entries that no longer match `schema` (e.g. written by an older deploy) count as a miss and are deleted. */
  async get<S extends z.ZodType>(key: string, schema: S): Promise<z.output<S> | null> {
    const raw = await this.redis.get(KEY_PREFIX + key);
    if (raw === null) {
      return null;
    }
    const parsed = schema.safeParse(parseJson(raw));
    if (!parsed.success) {
      await this.delete(key);
      return null;
    }
    return parsed.data;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(KEY_PREFIX + key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + key);
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
