import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { RankedQueue } from '../generated/prisma/enums.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { CacheService } from '../infra/redis/cache.service.js';
import { riotIdKey } from '../riot/riot-id.js';
import { isFresh, toPlayer, toPlayerProfile } from './player.mapper.js';
import { PlayerJobEvents } from './player-job-events.js';
import { PlayerSyncQueue } from './player-sync.queue.js';
import {
  notFoundCacheKey,
  PLAYERS_QUEUE,
  PlayerJob,
  RANK_HISTORY_POINTS,
  REFRESH_COOLDOWN_MS,
  type ResolveRiotIdData,
  type ResolveRiotIdResult,
  resolveRiotIdJobId,
  SyncPriority,
} from './players.constants.js';
import type {
  Player,
  PlayerProfile,
  PlayerRank,
  PlayerSearchPending,
  PlayerSearchQuery,
  RankHistory,
} from './players.schemas.js';

const SEARCH_WAIT_MS = 5000;

@Injectable()
export class PlayersService {
  private readonly logger = new Logger(PlayersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    @InjectQueue(PLAYERS_QUEUE) private readonly queue: Queue,
    private readonly jobEvents: PlayerJobEvents,
    private readonly syncQueue: PlayerSyncQueue,
  ) {}

  /** Always answers from the database; stale data queues a background sync on the way out. */
  async profile(puuid: string): Promise<PlayerProfile> {
    // Queue before database: a sync finishing between the two reads then shows up as fresh data,
    // not as a stale row with no job left, which would queue the same sync a second time.
    let syncing = await this.isSyncing(puuid);
    const account = await this.findAccount(puuid);
    if (!syncing && !isFresh(account.lastSyncedAt)) {
      syncing = await this.syncQueue
        .enqueue(puuid, SyncPriority.BACKGROUND)
        .catch((error: unknown) => {
          // Serving the stored profile beats failing the page because Redis is down.
          this.logger.warn(`Could not queue a sync for ${puuid}: ${String(error)}`);
          return false;
        });
    }
    return toPlayerProfile(account, syncing);
  }

  async rankHistory(puuid: string, queue: PlayerRank['queue']): Promise<RankHistory> {
    await this.findAccount(puuid);
    const snapshots = await this.prisma.rankSnapshot.findMany({
      where: { puuid, queue: queue === 'solo' ? RankedQueue.SOLO : RankedQueue.FLEX },
      orderBy: { takenAt: 'desc' },
      take: RANK_HISTORY_POINTS,
    });
    return {
      items: snapshots.reverse().map((snapshot) => ({
        takenAt: snapshot.takenAt.toISOString(),
        tier: snapshot.tier,
        division: snapshot.division,
        leaguePoints: snapshot.leaguePoints,
        wins: snapshot.wins,
        losses: snapshot.losses,
      })),
    };
  }

  async refresh(puuid: string): Promise<PlayerProfile> {
    const syncing = await this.isSyncing(puuid);
    const account = await this.findAccount(puuid);
    const sinceSync = account.lastSyncedAt && Date.now() - account.lastSyncedAt.getTime();
    if (sinceSync !== null && sinceSync < REFRESH_COOLDOWN_MS) {
      return toPlayerProfile(account, syncing);
    }
    try {
      await this.syncQueue.enqueue(puuid, SyncPriority.USER);
    } catch {
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return toPlayerProfile(account, true);
  }

  async search(query: PlayerSearchQuery): Promise<Player | PlayerSearchPending> {
    const key = riotIdKey(query.gameName, query.tagLine);
    const stored = await this.prisma.riotAccount.findFirst({
      where: { riotIdKey: key, platform: query.platform },
    });
    if (stored) {
      return toPlayer(stored, await this.isSyncing(stored.puuid));
    }
    if (await this.cache.get(notFoundCacheKey(query.platform, key), z.literal(true))) {
      throw playerNotFound();
    }

    const result = await this.waitFor(await this.enqueueResolve(query, key));
    if (result === undefined) {
      return { status: 'pending' };
    }
    if ('notFound' in result) {
      throw playerNotFound();
    }
    const account = await this.prisma.riotAccount.findUniqueOrThrow({
      where: { puuid: result.puuid },
    });
    return toPlayer(account, await this.isSyncing(account.puuid));
  }

  private async enqueueResolve(query: PlayerSearchQuery, key: string): Promise<Job> {
    const data: ResolveRiotIdData = query;
    const jobId = resolveRiotIdJobId(query.platform, key);
    try {
      // A failed job is kept for a while and would make `add` return it again; a new search deserves a new try.
      const previous = await this.queue.getJob(jobId);
      if (previous && (await previous.isFailed())) {
        await previous.remove();
      }
      return await this.queue.add(PlayerJob.RESOLVE_RIOT_ID, data, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 60 },
        removeOnFail: { age: 600 },
      });
    } catch {
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /** `undefined` while the job is still running or waiting for a retry or the rate limiter. */
  private async waitFor(job: Job): Promise<ResolveRiotIdResult | undefined> {
    try {
      return (await job.waitUntilFinished(this.jobEvents.queueEvents, SEARCH_WAIT_MS)) as
        | ResolveRiotIdResult
        | undefined;
    } catch {
      if ((await job.getState()) === 'failed') {
        throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE);
      }
      return undefined;
    }
  }

  private async findAccount(puuid: string) {
    const account = await this.prisma.riotAccount.findUnique({ where: { puuid } });
    if (!account) {
      throw playerNotFound();
    }
    return account;
  }

  private async isSyncing(puuid: string): Promise<boolean> {
    return this.syncQueue.isSyncing(puuid).catch(() => false);
  }
}

function playerNotFound(): AppException {
  return new AppException(ErrorCode.PLAYER_NOT_FOUND, HttpStatus.NOT_FOUND);
}
