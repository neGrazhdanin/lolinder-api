import type { RiotAccount } from '../generated/prisma/client.js';
import { platformSchema } from '../riot/routing.js';
import { FRESH_FOR_MS } from './players.constants.js';
import {
  championMasteriesSchema,
  type Player,
  type PlayerProfile,
  type PlayerSync,
  playerRanksSchema,
} from './players.schemas.js';

export function toPlayer(account: RiotAccount, syncing: boolean, now = Date.now()): Player {
  return {
    puuid: account.puuid,
    gameName: account.gameName,
    tagLine: account.tagLine,
    platform: platformSchema.parse(account.platform),
    profileIconId: account.profileIconId,
    summonerLevel: account.summonerLevel,
    sync: toSync(account.lastSyncedAt, syncing, now),
  };
}

export function toPlayerProfile(
  account: RiotAccount,
  syncing: boolean,
  now = Date.now(),
): PlayerProfile {
  return {
    ...toPlayer(account, syncing, now),
    ranks: playerRanksSchema.parse(account.ranks ?? []),
    topMasteries: championMasteriesSchema.parse(account.topMasteries ?? []),
  };
}

export function isFresh(lastSyncedAt: Date | null, now = Date.now()): boolean {
  return lastSyncedAt !== null && now - lastSyncedAt.getTime() < FRESH_FOR_MS;
}

function toSync(lastSyncedAt: Date | null, syncing: boolean, now: number): PlayerSync {
  return {
    status: syncing ? 'syncing' : isFresh(lastSyncedAt, now) ? 'fresh' : 'stale',
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
  };
}
