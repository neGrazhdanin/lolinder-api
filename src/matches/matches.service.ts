import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import type { Prisma, RiotAccount } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { isFresh } from '../players/player.mapper.js';
import { toMatch, toMatchHistoryItem } from './match.mapper.js';
import { MatchHistoryQueue } from './match-history.queue.js';
import { QUEUE_IDS } from './matches.constants.js';
import {
  encodeMatchCursor,
  type Match,
  type MatchCursor,
  type MatchHistoryPage,
  type MatchHistoryQuery,
} from './matches.schemas.js';

const historyParticipant = {
  select: {
    puuid: true,
    gameName: true,
    tagLine: true,
    teamId: true,
    subteamId: true,
    championId: true,
  },
  orderBy: { participantId: 'asc' },
} as const;

@Injectable()
export class MatchesService {
  private readonly logger = new Logger(MatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly historyQueue: MatchHistoryQueue,
  ) {}

  async history(puuid: string, query: MatchHistoryQuery): Promise<MatchHistoryPage> {
    // Queue before database, and no enqueue while a job is pending: a job finishing between the reads
    // then shows up as fresh data, instead of an outdated run that would queue the same job again.
    const pending = await this.historyQueue
      .pending(puuid)
      .catch(() => ({ newest: false, older: false }));
    const account = await this.prisma.riotAccount.findUnique({ where: { puuid } });
    if (!account) {
      throw new AppException(ErrorCode.PLAYER_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    const from = account.matchHistoryFrom;
    const canExtend = from !== null && !account.matchHistoryComplete;

    const rows = await this.findHistory(account, query);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);

    let { newest, older } = pending;
    if (!newest && !query.cursor && needsNewest(account)) {
      newest = await this.queue(() => this.historyQueue.syncNewest(puuid));
    }
    // Only the cursor issued before the run last grew asks for a batch: refetching the same page
    // after `player:matches-updated` must not walk the whole history one batch at a time.
    if (
      !older &&
      query.cursor &&
      page.length < query.limit &&
      canExtend &&
      query.cursor[2] === from.toISOString()
    ) {
      older = await this.queue(() => this.historyQueue.loadOlder(puuid));
    }

    return {
      items: page.map(toMatchHistoryItem),
      nextCursor: hasMore || (canExtend && !older) ? nextCursor(page, query.cursor, from) : null,
      loading: { newest, older },
    };
  }

  async match(matchId: string): Promise<Match> {
    const match = await this.prisma.match.findUnique({
      where: { matchId },
      include: { participants: { orderBy: { participantId: 'asc' } } },
    });
    if (!match) {
      throw new AppException(ErrorCode.MATCH_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return toMatch(match);
  }

  private findHistory(account: RiotAccount, query: MatchHistoryQuery) {
    const from = account.matchHistoryFrom;
    // Before the first sync, stored rows are other players' matches and may have gaps.
    if (!from && !account.matchHistoryComplete) {
      return Promise.resolve([]);
    }
    const where: Prisma.MatchParticipantWhereInput = {
      puuid: account.puuid,
      ...(query.queue && { queueId: { in: QUEUE_IDS[query.queue] } }),
      AND: [
        account.matchHistoryComplete || !from ? {} : { startedAt: { gte: from } },
        query.cursor ? afterCursor(query.cursor) : {},
      ],
    };
    return this.prisma.matchParticipant.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { matchId: 'desc' }],
      take: query.limit + 1,
      include: {
        match: {
          select: {
            patch: true,
            durationSec: true,
            remake: true,
            participants: historyParticipant,
          },
        },
      },
    });
  }

  private queue(enqueue: () => Promise<boolean>): Promise<boolean> {
    return enqueue().catch((error: unknown) => {
      this.logger.warn(`Could not queue a match history job: ${String(error)}`);
      return false;
    });
  }
}

/** The list follows profile syncs, so "Refresh" brings in the game just played. */
function needsNewest(account: RiotAccount): boolean {
  const synced = account.matchHistorySyncedAt;
  return (
    !synced || !isFresh(synced) || (account.lastSyncedAt !== null && synced < account.lastSyncedAt)
  );
}

function afterCursor([startedAt, matchId]: MatchCursor): Prisma.MatchParticipantWhereInput {
  const time = new Date(startedAt);
  return { OR: [{ startedAt: { lt: time } }, { startedAt: time, matchId: { lt: matchId } }] };
}

function nextCursor(
  page: { startedAt: Date; matchId: string }[],
  cursor: MatchCursor | undefined,
  from: Date | null,
): string | null {
  const last = page.at(-1);
  if (last) {
    return encodeMatchCursor(last.startedAt, last.matchId, from);
  }
  if (cursor) {
    return encodeMatchCursor(new Date(cursor[0]), cursor[1], from);
  }
  return from && encodeMatchCursor(from, '', from);
}
