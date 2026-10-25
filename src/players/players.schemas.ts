import { z } from 'zod';
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

export const playerSchema = z
  .object({
    puuid: z.string(),
    gameName: z.string(),
    tagLine: z.string(),
    platform: platformSchema,
    profileIconId: z.number().int().nullable(),
    summonerLevel: z.number().int().nullable(),
    lastSyncedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Player' });

export type Player = z.infer<typeof playerSchema>;

export const playerSearchPendingSchema = z
  .object({ status: z.literal('pending') })
  .meta({ id: 'PlayerSearchPending' });

export type PlayerSearchPending = z.infer<typeof playerSearchPendingSchema>;
