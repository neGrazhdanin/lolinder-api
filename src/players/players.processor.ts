import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { CacheService } from '../infra/redis/cache.service.js';
import { RealtimeEmitter } from '../realtime/realtime.emitter.js';
import { RiotClient } from '../riot/riot.client.js';
import { riotIdKey } from '../riot/riot-id.js';
import { runRiotJob } from '../riot/riot-job.js';
import { platformSchema } from '../riot/routing.js';
import { PlayerSyncQueue } from './player-sync.queue.js';
import { PlayerSyncService } from './player-sync.service.js';
import {
  NOT_FOUND_TTL_SECONDS,
  notFoundCacheKey,
  PLAYERS_CONCURRENCY,
  PLAYERS_QUEUE,
  PlayerJob,
  type ResolveRiotIdData,
  type ResolveRiotIdResult,
  type SyncPlayerData,
  SyncPriority,
} from './players.constants.js';

@Processor(PLAYERS_QUEUE, { concurrency: PLAYERS_CONCURRENCY })
export class PlayersProcessor extends WorkerHost {
  constructor(
    private readonly riot: RiotClient,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly playerSync: PlayerSyncService,
    private readonly syncQueue: PlayerSyncQueue,
    private readonly realtime: RealtimeEmitter,
  ) {
    super();
  }

  async process(job: Job, token?: string): Promise<ResolveRiotIdResult | undefined> {
    switch (job.name) {
      case PlayerJob.RESOLVE_RIOT_ID:
        return runRiotJob(job, token, () => this.resolveRiotId(job.data as ResolveRiotIdData));
      case PlayerJob.SYNC:
        await runRiotJob(job, token, () =>
          this.playerSync.sync((job.data as SyncPlayerData).puuid),
        );
        return undefined;
      default:
        throw new UnrecoverableError(`Unknown ${PLAYERS_QUEUE} job: ${job.name}`);
    }
  }

  private async resolveRiotId(data: ResolveRiotIdData): Promise<ResolveRiotIdResult> {
    const platform = platformSchema.parse(data.platform);
    const account = await this.riot.getAccountByRiotId(platform, data.gameName, data.tagLine);
    // account-v1 is global; summoner-v4 tells whether this Riot ID plays League on the chosen platform.
    const summoner = account && (await this.riot.getSummonerByPuuid(platform, account.puuid));
    if (!account || !summoner) {
      const key = notFoundCacheKey(platform, riotIdKey(data.gameName, data.tagLine));
      await this.cache.set(key, true, NOT_FOUND_TTL_SECONDS);
      return { notFound: true };
    }

    const gameName = account.gameName ?? data.gameName;
    const tagLine = account.tagLine ?? data.tagLine;
    const key = riotIdKey(gameName, tagLine);
    await this.refreshPreviousHolders(key, account.puuid);
    const fields = {
      gameName,
      tagLine,
      riotIdKey: key,
      platform,
      profileIconId: summoner.profileIconId,
      summonerLevel: summoner.summonerLevel,
    };
    await this.prisma.riotAccount.upsert({
      where: { puuid: account.puuid },
      create: { puuid: account.puuid, ...fields },
      update: fields,
    });
    // The searcher opens the profile next; ranks and masteries start loading right away.
    await this.syncQueue.enqueue(account.puuid, SyncPriority.USER);
    return { puuid: account.puuid };
  }

  // Clients show "syncing" until `player:updated`; a sync that gave up must still end that state.
  @OnWorkerEvent('failed')
  async onFailed(job: Job): Promise<void> {
    if (job.name === PlayerJob.SYNC && (await job.isFailed())) {
      this.realtime.playerUpdated({ puuid: (job.data as SyncPlayerData).puuid });
    }
  }

  // A stored account that still holds this Riot ID has renamed since: fetch its current name, so the
  // Riot ID points at one account again.
  private async refreshPreviousHolders(key: string, puuid: string): Promise<void> {
    const holders = await this.prisma.riotAccount.findMany({
      where: { riotIdKey: key, puuid: { not: puuid } },
      select: { puuid: true, platform: true },
    });
    for (const holder of holders) {
      const platform = platformSchema.parse(holder.platform);
      const current = await this.riot.getAccountByPuuid(platform, holder.puuid);
      if (current?.gameName && current.tagLine) {
        await this.prisma.riotAccount.update({
          where: { puuid: holder.puuid },
          data: {
            gameName: current.gameName,
            tagLine: current.tagLine,
            riotIdKey: riotIdKey(current.gameName, current.tagLine),
          },
        });
      }
    }
  }
}
