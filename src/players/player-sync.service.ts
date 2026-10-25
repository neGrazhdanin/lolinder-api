import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { RankedQueue } from '../generated/prisma/enums.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { RealtimeEmitter } from '../realtime/realtime.emitter.js';
import { RiotClient } from '../riot/riot.client.js';
import type { ChampionMasteryDto, LeagueEntryDto } from '../riot/riot.schemas.js';
import { riotIdKey } from '../riot/riot-id.js';
import { platformSchema } from '../riot/routing.js';
import { TOP_MASTERIES } from './players.constants.js';
import { type ChampionMastery, type PlayerRank, playerRankSchema } from './players.schemas.js';

const QUEUE_OF: Record<string, PlayerRank['queue']> = {
  RANKED_SOLO_5x5: 'solo',
  RANKED_FLEX_SR: 'flex',
};

const SNAPSHOT_QUEUE: Record<PlayerRank['queue'], RankedQueue> = {
  solo: RankedQueue.SOLO,
  flex: RankedQueue.FLEX,
};

/** Worker side of a player sync: one pass over account, summoner, league and mastery data. */
@Injectable()
export class PlayerSyncService {
  constructor(
    private readonly riot: RiotClient,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async sync(puuid: string): Promise<void> {
    const stored = await this.prisma.riotAccount.findUnique({ where: { puuid } });
    if (!stored) {
      return;
    }
    const platform = platformSchema.parse(stored.platform);
    const [account, summoner, entries, masteries] = await Promise.all([
      this.riot.getAccountByPuuid(platform, puuid),
      this.riot.getSummonerByPuuid(platform, puuid),
      this.riot.getLeagueEntries(platform, puuid),
      this.riot.getChampionMasteries(platform, puuid, TOP_MASTERIES),
    ]);
    const ranks = toRanks(entries);

    await this.prisma.$transaction(async (tx) => {
      await tx.riotAccount.update({
        where: { puuid },
        data: {
          // Players rename; the stored Riot ID must follow so search keeps finding them.
          ...(account?.gameName &&
            account.tagLine && {
              gameName: account.gameName,
              tagLine: account.tagLine,
              riotIdKey: riotIdKey(account.gameName, account.tagLine),
            }),
          ...(summoner && {
            profileIconId: summoner.profileIconId,
            summonerLevel: summoner.summonerLevel,
          }),
          ranks,
          topMasteries: toMasteries(masteries),
          lastSyncedAt: new Date(),
        },
      });
      await snapshotChangedRanks(tx, puuid, ranks);
    });
    this.realtime.playerUpdated({ puuid });
  }
}

function toRanks(entries: LeagueEntryDto[]): PlayerRank[] {
  return entries.flatMap((entry) => {
    const rank = playerRankSchema.safeParse({
      queue: QUEUE_OF[entry.queueType],
      tier: entry.tier,
      division: entry.rank,
      leaguePoints: entry.leaguePoints,
      wins: entry.wins,
      losses: entry.losses,
    });
    return rank.success ? [rank.data] : [];
  });
}

function toMasteries(masteries: ChampionMasteryDto[]): ChampionMastery[] {
  return masteries.map((mastery) => ({
    championId: mastery.championId,
    level: mastery.championLevel,
    points: mastery.championPoints,
    lastPlayedAt: new Date(mastery.lastPlayTime).toISOString(),
  }));
}

// A snapshot per sync would repeat the same row every few minutes for a player who is not playing.
async function snapshotChangedRanks(
  tx: Prisma.TransactionClient,
  puuid: string,
  ranks: PlayerRank[],
): Promise<void> {
  for (const rank of ranks) {
    const queue = SNAPSHOT_QUEUE[rank.queue];
    const latest = await tx.rankSnapshot.findFirst({
      where: { puuid, queue },
      orderBy: { takenAt: 'desc' },
    });
    const changed =
      !latest ||
      latest.tier !== rank.tier ||
      latest.division !== rank.division ||
      latest.leaguePoints !== rank.leaguePoints ||
      latest.wins !== rank.wins ||
      latest.losses !== rank.losses;
    if (changed) {
      await tx.rankSnapshot.create({
        data: {
          puuid,
          queue,
          tier: rank.tier,
          division: rank.division,
          leaguePoints: rank.leaguePoints,
          wins: rank.wins,
          losses: rank.losses,
        },
      });
    }
  }
}
