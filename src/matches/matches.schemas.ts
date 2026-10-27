import { z } from 'zod';
import { puuidSchema } from '../riot/riot-id.js';
import { MATCH_PAGE_SIZE, MATCH_QUEUE_FILTERS, MAX_MATCH_PAGE_SIZE } from './matches.constants.js';

export const matchIdSchema = z.string().regex(/^[A-Z0-9]{2,8}_\d{1,20}$/);

export const matchParamsSchema = z.object({ matchId: matchIdSchema });

// Last position shown plus the run start it was issued under (see MatchesService.history).
// An empty match ID marks the position just before the run start.
export const matchCursorSchema = z.tuple([
  z.iso.datetime(),
  z.union([matchIdSchema, z.literal('')]),
  z.iso.datetime().nullable(),
]);

export type MatchCursor = z.infer<typeof matchCursorSchema>;

export function encodeMatchCursor(startedAt: Date, matchId: string, runFrom: Date | null): string {
  const cursor: MatchCursor = [startedAt.toISOString(), matchId, runFrom?.toISOString() ?? null];
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeMatchCursor(value: string, ctx: z.RefinementCtx<string>): MatchCursor {
  try {
    const cursor = matchCursorSchema.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString()),
    );
    if (cursor.success) {
      return cursor.data;
    }
  } catch {}
  ctx.addIssue({ code: 'custom', message: 'Invalid cursor' });
  return z.NEVER;
}

export const matchHistoryQuerySchema = z.object({
  cursor: z.string().max(200).transform(decodeMatchCursor).optional(),
  queue: z.enum(MATCH_QUEUE_FILTERS).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_MATCH_PAGE_SIZE).default(MATCH_PAGE_SIZE),
});

export type MatchHistoryQuery = z.infer<typeof matchHistoryQuerySchema>;

// Also the shape of `match_participants.runes`, so reads parse what the worker wrote.
export const matchRunesSchema = z
  .object({
    primaryStyle: z.number().int().nullable(),
    subStyle: z.number().int().nullable(),
    perks: z
      .array(z.number().int())
      .describe('Primary tree selections, keystone first, then the secondary tree'),
    statPerks: z.array(z.number().int()).describe('Offense, flex and defense shards'),
  })
  .meta({ id: 'MatchRunes' });

export type MatchRunes = z.infer<typeof matchRunesSchema>;

const participantStatsSchema = z.object({
  teamId: z.number().int(),
  subteamId: z.number().int().nullable().describe('Arena duo, 1–8; null in team modes'),
  placement: z.number().int().nullable().describe('Arena finish, 1–8; null in team modes'),
  championId: z.number().int(),
  champLevel: z.number().int(),
  role: z.string().nullable(),
  kills: z.number().int(),
  deaths: z.number().int(),
  assists: z.number().int(),
  damageToChampions: z.number().int(),
  goldEarned: z.number().int(),
  cs: z.number().int(),
  visionScore: z.number().int(),
  items: z
    .array(z.number().int())
    .length(7)
    .describe('item0 to item6: 0 is an empty slot, the last one is the trinket'),
  summonerSpells: z.array(z.number().int()).length(2),
  runes: matchRunesSchema,
  win: z.boolean(),
});

const matchFieldsSchema = z.object({
  matchId: z.string(),
  queueId: z.number().int(),
  patch: z.string(),
  startedAt: z.iso.datetime(),
  durationSec: z.number().int(),
  remake: z.boolean().describe('Ended by an early surrender vote: no win or loss counts'),
});

const riotIdFields = {
  puuid: z.string(),
  gameName: z.string().nullable().describe('Riot ID at the time of the match; null for bots'),
  tagLine: z.string().nullable(),
};

export const matchParticipantSchema = participantStatsSchema
  .extend({ participantId: z.number().int(), ...riotIdFields })
  .meta({ id: 'MatchParticipant' });

export const matchSchema = matchFieldsSchema
  .extend({
    platform: z.string(),
    winnerTeam: z.number().int().nullable(),
    participants: z.array(matchParticipantSchema),
  })
  .meta({ id: 'Match' });

export type Match = z.infer<typeof matchSchema>;

export const matchHistoryParticipantSchema = z
  .object({
    ...riotIdFields,
    teamId: z.number().int(),
    subteamId: participantStatsSchema.shape.subteamId,
    championId: z.number().int(),
  })
  .meta({ id: 'MatchHistoryParticipant' });

export const matchHistoryItemSchema = matchFieldsSchema
  .extend(participantStatsSchema.shape)
  .extend({ participants: z.array(matchHistoryParticipantSchema) })
  .meta({ id: 'MatchHistoryItem' });

export type MatchHistoryItem = z.infer<typeof matchHistoryItemSchema>;

export const matchHistoryPageSchema = z
  .object({
    items: z.array(matchHistoryItemSchema),
    nextCursor: z
      .string()
      .nullable()
      .describe('Null at the end of the history, or while older matches load for this page'),
    loading: z
      .object({ newest: z.boolean(), older: z.boolean() })
      .describe('The worker is fetching newer or older matches: refetch on player:matches-updated'),
  })
  .meta({ id: 'MatchHistoryPage' });

export type MatchHistoryPage = z.infer<typeof matchHistoryPageSchema>;

export const playerMatchesParamsSchema = z.object({ puuid: puuidSchema });
