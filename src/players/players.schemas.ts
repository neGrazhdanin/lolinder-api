import { z } from 'zod';
import { puuidSchema } from '../riot/riot-id.js';
import { platformSchema } from '../riot/routing.js';

// Riot ID limits: game name up to 16 characters, tag line up to 5 letters or digits.
export const playerSearchQuerySchema = z.object({
  platform: platformSchema,
  gameName: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .refine((value) => !value.includes('#')),
  // Users often type the tag with its `#`. The letter check is a refine, not a regex: OpenAPI would
  // publish it as a `pattern`, and browsers evaluate that without the `u` flag `\p{…}` needs.
  tagLine: z
    .string()
    .trim()
    .transform((value) => value.replace(/^#/, ''))
    .pipe(
      z
        .string()
        .min(1)
        .max(5)
        .refine((value) => /^[\p{L}\p{N}]+$/u.test(value)),
    ),
});

export type PlayerSearchQuery = z.infer<typeof playerSearchQuerySchema>;

export const SYNC_STATUSES = ['fresh', 'syncing', 'stale'] as const;

export const playerSyncSchema = z
  .object({
    status: z.enum(SYNC_STATUSES),
    lastSyncedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'PlayerSync' });

export type PlayerSync = z.infer<typeof playerSyncSchema>;

export const playerSchema = z
  .object({
    puuid: z.string(),
    gameName: z.string(),
    tagLine: z.string(),
    platform: platformSchema,
    profileIconId: z.number().int().nullable(),
    summonerLevel: z.number().int().nullable(),
    sync: playerSyncSchema,
  })
  .meta({ id: 'Player' });

export type Player = z.infer<typeof playerSchema>;

export const playerRankSchema = z
  .object({
    queue: z.enum(['solo', 'flex']),
    tier: z.enum([
      'IRON',
      'BRONZE',
      'SILVER',
      'GOLD',
      'PLATINUM',
      'EMERALD',
      'DIAMOND',
      'MASTER',
      'GRANDMASTER',
      'CHALLENGER',
    ]),
    division: z.enum(['I', 'II', 'III', 'IV']),
    leaguePoints: z.number().int(),
    wins: z.number().int(),
    losses: z.number().int(),
  })
  .meta({ id: 'PlayerRank' });

export type PlayerRank = z.infer<typeof playerRankSchema>;

export const championMasterySchema = z
  .object({
    championId: z.number().int(),
    level: z.number().int(),
    points: z.number().int(),
    lastPlayedAt: z.iso.datetime(),
  })
  .meta({ id: 'ChampionMastery' });

export type ChampionMastery = z.infer<typeof championMasterySchema>;

// Also the shape of `riot_accounts.ranks` and `top_masteries`, so reads parse what the worker wrote.
export const playerRanksSchema = z.array(playerRankSchema);
export const championMasteriesSchema = z.array(championMasterySchema);

export const playerProfileSchema = playerSchema
  .extend({ ranks: playerRanksSchema, topMasteries: championMasteriesSchema })
  .meta({ id: 'PlayerProfile' });

export type PlayerProfile = z.infer<typeof playerProfileSchema>;

export const playerParamsSchema = z.object({ puuid: puuidSchema });

export const rankHistoryQuerySchema = z.object({
  queue: playerRankSchema.shape.queue.default('solo'),
});

export const rankHistoryPointSchema = playerRankSchema
  .omit({ queue: true })
  .extend({ takenAt: z.iso.datetime() })
  .meta({ id: 'RankHistoryPoint' });

export const rankHistorySchema = z
  .object({ items: z.array(rankHistoryPointSchema) })
  .meta({ id: 'RankHistory' });

export type RankHistory = z.infer<typeof rankHistorySchema>;

export const playerSearchPendingSchema = z
  .object({ status: z.literal('pending') })
  .meta({ id: 'PlayerSearchPending' });

export type PlayerSearchPending = z.infer<typeof playerSearchPendingSchema>;
