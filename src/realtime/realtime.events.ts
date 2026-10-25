import { z } from 'zod';
import { puuidSchema } from '../riot/riot-id.js';

// Shared by the API gateway and the worker emitter; the web client listens for the same names.
export const RealtimeEvent = {
  SUBSCRIBE_PLAYER: 'player:subscribe',
  UNSUBSCRIBE_PLAYER: 'player:unsubscribe',
  PLAYER_UPDATED: 'player:updated',
} as const;

export function playerRoom(puuid: string): string {
  return `player:${puuid}`;
}

export const playerSubscriptionSchema = z.object({ puuid: puuidSchema });

export type PlayerSubscription = z.infer<typeof playerSubscriptionSchema>;

export interface PlayerUpdatedEvent {
  puuid: string;
}
