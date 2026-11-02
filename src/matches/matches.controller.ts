import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { TIMELINE_RETRY_AFTER_SECONDS } from './matches.constants.js';
import {
  type Match,
  type MatchHistoryPage,
  type MatchHistoryQuery,
  matchHistoryPageSchema,
  matchHistoryQuerySchema,
  matchParamsSchema,
  matchSchema,
  playerMatchesParamsSchema,
  type Timeline,
  type TimelinePending,
  timelinePendingSchema,
  timelineSchema,
} from './matches.schemas.js';
import { MatchesService } from './matches.service.js';

@Controller()
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get('players/:puuid/matches')
  @ApiOkResponse({ standardSchema: matchHistoryPageSchema })
  async history(
    @Param({ schema: playerMatchesParamsSchema }) {
      puuid,
    }: z.infer<typeof playerMatchesParamsSchema>,
    @Query({ schema: matchHistoryQuerySchema }) query: MatchHistoryQuery,
  ): Promise<MatchHistoryPage> {
    return this.matches.history(puuid, query);
  }

  @Get('matches/:matchId')
  @ApiOkResponse({ standardSchema: matchSchema })
  async match(
    @Param({ schema: matchParamsSchema }) { matchId }: z.infer<typeof matchParamsSchema>,
  ): Promise<Match> {
    return this.matches.match(matchId);
  }

  @Get('matches/:matchId/timeline')
  @ApiOkResponse({ standardSchema: timelineSchema })
  @ApiResponse({
    status: 202,
    description: 'Fetching from Riot: repeat the request after Retry-After seconds',
    standardSchema: timelinePendingSchema,
  })
  async timeline(
    @Param({ schema: matchParamsSchema }) { matchId }: z.infer<typeof matchParamsSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Timeline | TimelinePending> {
    const result = await this.matches.timeline(matchId);
    if ('status' in result) {
      void reply.status(202).header('Retry-After', String(TIMELINE_RETRY_AFTER_SECONDS));
    }
    return result;
  }
}
