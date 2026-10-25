import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { RiotAccount } from '../generated/prisma/client.js';
import type { PrismaService } from '../infra/prisma/prisma.service.js';
import type { CacheService } from '../infra/redis/cache.service.js';
import type { PlayerJobEvents } from './player-job-events.js';
import type { PlayerSyncQueue } from './player-sync.queue.js';
import { PlayersService } from './players.service.js';

const puuid = 'p'.repeat(78);

function account(lastSyncedAt: Date | null): RiotAccount {
  return {
    puuid,
    gameName: 'Faker',
    tagLine: 'KR1',
    riotIdKey: 'faker#kr1',
    platform: 'kr',
    profileIconId: 6,
    summonerLevel: 800,
    ranks: [],
    topMasteries: [],
    lastSyncedAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('PlayersService.profile', () => {
  it('does not queue a second sync when the running one finishes during the request', async () => {
    // The worker finishes right after whichever read comes first: the row becomes fresh and the job disappears.
    let synced = false;
    const prisma = {
      riotAccount: {
        findUnique: vi.fn(async () => {
          const row = account(synced ? new Date() : null);
          synced = true;
          return row;
        }),
      },
    };
    const syncQueue = {
      isSyncing: vi.fn(async () => {
        const running = !synced;
        synced = true;
        return running;
      }),
      enqueue: vi.fn(async () => true),
    };
    const service = new PlayersService(
      prisma as unknown as PrismaService,
      {} as CacheService,
      {} as Queue,
      {} as PlayerJobEvents,
      syncQueue as unknown as PlayerSyncQueue,
    );

    await service.profile(puuid);

    expect(syncQueue.enqueue).not.toHaveBeenCalled();
  });
});
