/** Value of `riot_accounts.riot_id_key`: Riot IDs are case-insensitive. */
export function riotIdKey(gameName: string, tagLine: string): string {
  return `${gameName}#${tagLine}`.toLowerCase();
}
