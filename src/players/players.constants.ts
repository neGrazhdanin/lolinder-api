import type { Platform } from '../riot/routing.js';

export const PLAYERS_QUEUE = 'players';

export const PlayerJob = {
  RESOLVE_RIOT_ID: 'resolve-riot-id',
} as const;

export interface ResolveRiotIdData {
  platform: Platform;
  gameName: string;
  tagLine: string;
}

export type ResolveRiotIdResult = { puuid: string } | { notFound: true };

/** One job per Riot ID and platform at a time: concurrent searches share it. */
export function resolveRiotIdJobId(platform: Platform, riotIdKey: string): string {
  // BullMQ rejects `:` in custom job IDs, and game names may contain it.
  return `resolve-${platform}-${Buffer.from(riotIdKey).toString('base64url')}`;
}

export function notFoundCacheKey(platform: Platform, riotIdKey: string): string {
  return `player-search:not-found:${platform}:${riotIdKey}`;
}

// Long enough to absorb repeated searches for a typo, short enough for a fresh account to show up.
export const NOT_FOUND_TTL_SECONDS = 300;
