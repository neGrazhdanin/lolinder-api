import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.constants.js';

export type DependencyStatus = 'up' | 'down';
export type HealthChecks = Record<'postgres' | 'redis', DependencyStatus>;

// Both clients queue commands while reconnecting, so a dead dependency hangs instead of failing.
const PROBE_TIMEOUT_MS = 1000;
// /health is public and unthrottled; reusing the result keeps it from hitting the database on every call.
const RESULT_TTL_MS = 2000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private cached?: { expiresAt: number; checks: Promise<HealthChecks> };

  check(): Promise<HealthChecks> {
    const now = Date.now();
    if (!this.cached || this.cached.expiresAt <= now) {
      this.cached = { expiresAt: now + RESULT_TTL_MS, checks: this.probeAll() };
    }
    return this.cached.checks;
  }

  private async probeAll(): Promise<HealthChecks> {
    const [postgres, redis] = await Promise.all([
      probe(() => this.prisma.$queryRaw`select 1`),
      probe(() => this.redis.ping()),
    ]);
    return { postgres, redis };
  }
}

async function probe(run: () => Promise<unknown>): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('probe timed out')), PROBE_TIMEOUT_MS);
  });
  try {
    await Promise.race([run(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}
