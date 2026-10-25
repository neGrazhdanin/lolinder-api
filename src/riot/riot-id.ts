import { z } from 'zod';

/** Value of `riot_accounts.riot_id_key`: Riot IDs are case-insensitive. */
export function riotIdKey(gameName: string, tagLine: string): string {
  return `${gameName}#${tagLine}`.toLowerCase();
}

// Encrypted PUUIDs are 78 URL-safe characters for every API key type.
export const puuidSchema = z.string().regex(/^[\w-]{78}$/);
