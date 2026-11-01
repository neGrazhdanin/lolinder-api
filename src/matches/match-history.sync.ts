import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { RealtimeEmitter } from '../realtime/realtime.emitter.js';
import { RiotClient } from '../riot/riot.client.js';
import { type Platform, platformSchema } from '../riot/routing.js';
import { toMatchRecord } from './match-record.js';
import {
  MATCH_FETCH_PARALLEL,
  MATCH_IDS_BATCH,
  MAX_BATCHES_PER_JOB,
  OLDER_BATCH_OVERLAP_MS,
} from './matches.constants.js';

@Injectable()
export class MatchHistorySync {
  constructor(
    private readonly riot: RiotClient,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async syncNewest(puuid: string): Promise<void> {
    const account = await this.prisma.riotAccount.findUnique({ where: { puuid } });
    if (!account) {
      return;
    }
    const platform = platformSchema.parse(account.platform);
    const ids = await this.riot.getMatchIds(platform, puuid, { count: MATCH_IDS_BATCH });
    const span = timeSpan(await this.store(platform, ids));
    const to = account.matchHistoryTo;

    let run = {};
    if (ids.length < MATCH_IDS_BATCH) {
      run = {
        matchHistoryFrom: span?.oldest ?? null,
        matchHistoryTo: span?.newest ?? null,
        matchHistoryComplete: true,
      };
    } else if (span && to && span.oldest <= to) {
      run = { matchHistoryTo: new Date(Math.max(span.newest.getTime(), to.getTime())) };
    } else if (span) {
      // More than a batch was played since the last sync: older pages load again from here.
      run = {
        matchHistoryFrom: span.oldest,
        matchHistoryTo: span.newest,
        matchHistoryComplete: false,
      };
    }
    await this.prisma.riotAccount.update({
      where: { puuid },
      data: { ...run, matchHistorySyncedAt: new Date() },
    });
    this.realtime.playerMatchesUpdated({ puuid });
  }

  async loadOlder(puuid: string): Promise<void> {
    const account = await this.prisma.riotAccount.findUnique({ where: { puuid } });
    const from = account?.matchHistoryFrom;
    if (!account || !from || account.matchHistoryComplete) {
      return;
    }
    const platform = platformSchema.parse(account.platform);
    const endTime = new Date(from.getTime() + OLDER_BATCH_OVERLAP_MS);
    let oldest = from;
    let complete = false;
    for (let batch = 0; batch < MAX_BATCHES_PER_JOB && oldest >= from; batch++) {
      const ids = await this.riot.getMatchIds(platform, puuid, {
        start: batch * MATCH_IDS_BATCH,
        count: MATCH_IDS_BATCH,
        endTime,
      });
      const span = timeSpan(await this.store(platform, ids));
      if (span && span.oldest < oldest) {
        oldest = span.oldest;
      }
      if (ids.length < MATCH_IDS_BATCH) {
        complete = true;
        break;
      }
    }
    // A newest sync that restarted the run meanwhile wins: this batch may not reach its new start.
    await this.prisma.riotAccount.updateMany({
      where: { puuid, matchHistoryFrom: from },
      data: { matchHistoryFrom: oldest, matchHistoryComplete: complete },
    });
    this.realtime.playerMatchesUpdated({ puuid });
  }

  private async store(platform: Platform, ids: string[]): Promise<Date[]> {
    const known = await this.prisma.match.findMany({
      where: { matchId: { in: ids } },
      select: { matchId: true, startedAt: true },
    });
    const startTimes = known.map((match) => match.startedAt);
    const knownIds = new Set(known.map((match) => match.matchId));
    const missing = ids.filter((id) => !knownIds.has(id));

    for (let i = 0; i < missing.length; i += MATCH_FETCH_PARALLEL) {
      const results = await Promise.allSettled(
        missing.slice(i, i + MATCH_FETCH_PARALLEL).map((id) => this.fetchMatch(platform, id)),
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          throw result.reason;
        }
        if (result.value) {
          startTimes.push(result.value);
        }
      }
    }
    return startTimes;
  }

  private async fetchMatch(platform: Platform, matchId: string): Promise<Date | null> {
    const dto = await this.riot.getMatch(platform, matchId);
    if (!dto) {
      return null;
    }
    const record = toMatchRecord(dto);
    // Players from one game sync their histories at once; whoever stores the match second skips it.
    await this.prisma.$transaction([
      this.prisma.match.createMany({ data: [record.match], skipDuplicates: true }),
      this.prisma.matchParticipant.createMany({ data: record.participants, skipDuplicates: true }),
    ]);
    return record.match.startedAt;
  }
}

function timeSpan(times: Date[]): { oldest: Date; newest: Date } | null {
  if (times.length === 0) {
    return null;
  }
  const ms = times.map((time) => time.getTime());
  return { oldest: new Date(Math.min(...ms)), newest: new Date(Math.max(...ms)) };
}
