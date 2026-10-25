import type { Platform } from '../riot/routing.js';

export const PLAYERS_QUEUE = 'players';

export const PlayerJob = {
  RESOLVE_RIOT_ID: 'resolve-riot-id',
  SYNC: 'sync-player',
} as const;

export interface SyncPlayerData {
  puuid: string;
}

// BullMQ runs lower numbers first; unprioritized jobs such as Riot ID lookups run before both.
export const SyncPriority = {
  USER: 1,
  BACKGROUND: 10,
} as const;

export type SyncPriority = (typeof SyncPriority)[keyof typeof SyncPriority];

export function syncJobId(puuid: string): string {
  return `sync-${puuid}`;
}

// Newer data counts as fresh: the profile shows it without queueing a sync.
export const FRESH_FOR_MS = 10 * 60 * 1000;
// "Refresh" clicks within this window after a sync are answered from the database.
export const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
export const TOP_MASTERIES = 10;
// After a failed sync, page views wait this long before queueing another; "Refresh" does not wait.
export const FAILED_SYNC_BACKOFF_MS = 5 * 60 * 1000;

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
