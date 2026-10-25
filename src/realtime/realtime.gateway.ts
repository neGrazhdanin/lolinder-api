import { HttpStatus, UseFilters } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { HttpErrorFilter } from '../common/errors/http-error.filter.js';
import {
  type PlayerSubscription,
  playerRoom,
  playerSubscriptionSchema,
  RealtimeEvent,
} from './realtime.events.js';

// Player pages are public, so any client may follow any player; the cap only bounds memory per socket.
const MAX_PLAYER_ROOMS = 20;

// The global ThrottlerGuard also runs on socket messages but keys on `req.ip`, which sockets lack,
// so every client would share one 100-per-minute bucket.
@SkipThrottle()
// APP_FILTER covers HTTP only; without this, socket errors use Nest's `{ status, message, cause }` shape.
@UseFilters(HttpErrorFilter)
@WebSocketGateway()
export class RealtimeGateway {
  @SubscribeMessage(RealtimeEvent.SUBSCRIBE_PLAYER)
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody({ schema: playerSubscriptionSchema }) { puuid }: PlayerSubscription,
  ): Promise<true> {
    const playerRooms = [...client.rooms].filter((room) => room.startsWith('player:'));
    if (playerRooms.length >= MAX_PLAYER_ROOMS && !playerRooms.includes(playerRoom(puuid))) {
      throw new AppException(ErrorCode.BAD_REQUEST, HttpStatus.BAD_REQUEST, {
        maxPlayerRooms: MAX_PLAYER_ROOMS,
      });
    }
    await client.join(playerRoom(puuid));
    return true;
  }

  @SubscribeMessage(RealtimeEvent.UNSUBSCRIBE_PLAYER)
  async unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody({ schema: playerSubscriptionSchema }) { puuid }: PlayerSubscription,
  ): Promise<true> {
    await client.leave(playerRoom(puuid));
    return true;
  }
}
