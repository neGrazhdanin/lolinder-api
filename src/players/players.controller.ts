import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import {
  type Player,
  type PlayerSearchPending,
  type PlayerSearchQuery,
  playerSchema,
  playerSearchPendingSchema,
  playerSearchQuerySchema,
} from './players.schemas.js';
import { PlayersService } from './players.service.js';

const SEARCH_RETRY_AFTER_SECONDS = 3;

@Controller('players')
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  // Unknown Riot IDs cost Riot API budget, so search gets a tighter limit than the global one.
  @Get('search')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOkResponse({ standardSchema: playerSchema })
  @ApiResponse({
    status: 202,
    description: 'Lookup still running: repeat the request after Retry-After seconds',
    standardSchema: playerSearchPendingSchema,
  })
  async search(
    @Query({ schema: playerSearchQuerySchema }) query: PlayerSearchQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Player | PlayerSearchPending> {
    const result = await this.players.search(query);
    if ('status' in result) {
      void reply.status(202).header('Retry-After', String(SEARCH_RETRY_AFTER_SECONDS));
    }
    return result;
  }
}
