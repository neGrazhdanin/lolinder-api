import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { CacheService } from '../infra/redis/cache.service.js';
import { riotIdKey } from '../riot/riot-id.js';
import { toPlayer } from './player.mapper.js';
import { PlayerJobEvents } from './player-job-events.js';
import {
  notFoundCacheKey,
  PLAYERS_QUEUE,
  PlayerJob,
  type ResolveRiotIdData,
  type ResolveRiotIdResult,
  resolveRiotIdJobId,
} from './players.constants.js';
import type { Player, PlayerSearchPending, PlayerSearchQuery } from './players.schemas.js';

const SEARCH_WAIT_MS = 5000;

@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    @InjectQueue(PLAYERS_QUEUE) private readonly queue: Queue,
    private readonly jobEvents: PlayerJobEvents,
  ) {}

  async search(query: PlayerSearchQuery): Promise<Player | PlayerSearchPending> {
    const key = riotIdKey(query.gameName, query.tagLine);
    const stored = await this.prisma.riotAccount.findFirst({
      where: { riotIdKey: key, platform: query.platform },
    });
    if (stored) {
      return toPlayer(stored);
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
    return toPlayer(
      await this.prisma.riotAccount.findUniqueOrThrow({ where: { puuid: result.puuid } }),
    );
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
}

function playerNotFound(): AppException {
  return new AppException(ErrorCode.PLAYER_NOT_FOUND, HttpStatus.NOT_FOUND);
}
