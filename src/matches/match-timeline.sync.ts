import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { RiotClient } from '../riot/riot.client.js';
import { platformSchema } from '../riot/routing.js';
import { toTimelineRecord } from './timeline-record.js';

@Injectable()
export class MatchTimelineSync {
  constructor(
    private readonly riot: RiotClient,
    private readonly prisma: PrismaService,
  ) {}

  async fetch(matchId: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { matchId },
      select: { platform: true, timeline: { select: { matchId: true } } },
    });
    if (!match || match.timeline) {
      return;
    }
    const dto = await this.riot.getMatchTimeline(platformSchema.parse(match.platform), matchId);
    // Riot drops old timelines; an empty row keeps every later page view from asking again.
    const record = dto
      ? toTimelineRecord(dto)
      : { frames: { times: [], participants: [] }, events: { items: [], skills: [] } };
    await this.prisma.matchTimeline.createMany({
      data: [
        {
          matchId,
          frames: record.frames as Prisma.InputJsonValue,
          events: record.events as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
  }
}
