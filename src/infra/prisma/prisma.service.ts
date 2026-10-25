import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../../config/env.js';
import { PrismaClient } from '../../generated/prisma/client.js';

// Raw Riot payloads are hundreds of KB per row; queries opt in with `omit: { rawJson: false }`.
const omit = {
  match: { rawJson: true },
  matchTimeline: { frames: true, events: true },
} as const;

@Injectable()
export class PrismaService
  extends PrismaClient<{ adapter: PrismaPg; omit: typeof omit }>
  implements OnApplicationShutdown
{
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        // pg defaults: wait forever for a free connection and drop idle ones after 10 s.
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 300_000,
        options: '-c statement_timeout=10000',
      }),
      omit,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
