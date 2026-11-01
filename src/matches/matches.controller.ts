import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  type Match,
  type MatchHistoryPage,
  type MatchHistoryQuery,
  matchHistoryPageSchema,
  matchHistoryQuerySchema,
  matchParamsSchema,
  matchSchema,
  playerMatchesParamsSchema,
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
}
