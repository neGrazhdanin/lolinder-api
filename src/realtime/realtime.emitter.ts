import { Inject, Injectable } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';
import { REDIS } from '../infra/redis/redis.constants.js';
import { type PlayerUpdatedEvent, playerRoom, RealtimeEvent } from './realtime.events.js';

/** Lets the worker reach connected clients without running a socket.io server. */
@Injectable()
export class RealtimeEmitter {
  private readonly emitter: Emitter;

  constructor(@Inject(REDIS) redis: Redis) {
    this.emitter = new Emitter(redis);
  }

  playerUpdated(event: PlayerUpdatedEvent): void {
    this.emitter.to(playerRoom(event.puuid)).emit(RealtimeEvent.PLAYER_UPDATED, event);
  }
}
