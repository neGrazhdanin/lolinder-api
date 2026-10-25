import type { RiotAccount } from '../generated/prisma/client.js';
import { platformSchema } from '../riot/routing.js';
import type { Player } from './players.schemas.js';

export function toPlayer(account: RiotAccount): Player {
  return {
    puuid: account.puuid,
    gameName: account.gameName,
    tagLine: account.tagLine,
    platform: platformSchema.parse(account.platform),
    profileIconId: account.profileIconId,
    summonerLevel: account.summonerLevel,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
  };
}
