import { z } from 'zod';

export const accountSchema = z.object({
  puuid: z.string(),
  gameName: z.string().optional(),
  tagLine: z.string().optional(),
});

export const summonerSchema = z.object({
  puuid: z.string(),
  profileIconId: z.number().int(),
  revisionDate: z.number().int(),
  summonerLevel: z.number().int(),
});

// Riot adds queues and tiers for event modes (for example JADE_RANKED_SOLO_5x5 with tier WOOD), so
// these stay plain strings here and callers keep the values they know.
export const leagueEntrySchema = z.object({
  puuid: z.string(),
  queueType: z.string(),
  tier: z.string(),
  rank: z.string(),
  leaguePoints: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
});

export const leagueEntriesSchema = z.array(leagueEntrySchema);

export const championMasterySchema = z.object({
  puuid: z.string(),
  championId: z.number().int(),
  championLevel: z.number().int(),
  championPoints: z.number().int(),
  lastPlayTime: z.number().int(),
});

export const championMasteriesSchema = z.array(championMasterySchema);

export const matchIdsSchema = z.array(z.string());

// Match and timeline objects are loose: the full payload is stored as raw JSON, so unknown keys must survive parsing.
const matchParticipantSchema = z.looseObject({
  participantId: z.number().int(),
  puuid: z.string(),
  riotIdGameName: z.string().optional(),
  riotIdTagline: z.string().optional(),
  teamId: z.number().int(),
  playerSubteamId: z.number().int().optional(),
  placement: z.number().int().optional(),
  championId: z.number().int(),
  champLevel: z.number().int(),
  teamPosition: z.string(),
  win: z.boolean(),
  kills: z.number().int(),
  deaths: z.number().int(),
  assists: z.number().int(),
  totalDamageDealtToChampions: z.number().int(),
  goldEarned: z.number().int(),
  totalMinionsKilled: z.number().int(),
  neutralMinionsKilled: z.number().int(),
  visionScore: z.number().int(),
  item0: z.number().int(),
  item1: z.number().int(),
  item2: z.number().int(),
  item3: z.number().int(),
  item4: z.number().int(),
  item5: z.number().int(),
  item6: z.number().int(),
  summoner1Id: z.number().int(),
  summoner2Id: z.number().int(),
  gameEndedInEarlySurrender: z.boolean().optional(),
  perks: z.looseObject({
    statPerks: z
      .looseObject({ offense: z.number().int(), flex: z.number().int(), defense: z.number().int() })
      .optional(),
    styles: z
      .array(
        z.looseObject({
          description: z.string(),
          style: z.number().int(),
          selections: z.array(z.looseObject({ perk: z.number().int() })),
        }),
      )
      .default([]),
  }),
});

export const matchSchema = z.looseObject({
  metadata: z.looseObject({
    matchId: z.string(),
    participants: z.array(z.string()),
  }),
  info: z.looseObject({
    platformId: z.string(),
    queueId: z.number().int(),
    gameVersion: z.string(),
    gameStartTimestamp: z.number().int(),
    // Absent before patch 11.20, when `gameDuration` was in milliseconds instead of seconds.
    gameEndTimestamp: z.number().int().optional(),
    gameDuration: z.number().int(),
    participants: z.array(matchParticipantSchema),
    teams: z.array(z.looseObject({ teamId: z.number().int(), win: z.boolean() })),
  }),
});

export const matchTimelineSchema = z.looseObject({
  metadata: z.looseObject({ matchId: z.string() }),
  info: z.looseObject({
    frameInterval: z.number().int(),
    frames: z.array(
      z.looseObject({
        timestamp: z.number().int(),
        participantFrames: z.record(z.string(), z.looseObject({})),
        events: z.array(z.looseObject({ type: z.string(), timestamp: z.number().int() })),
      }),
    ),
  }),
});

export const activeGameSchema = z.object({
  gameId: z.number().int(),
  gameQueueConfigId: z.number().int().optional(),
  gameMode: z.string(),
  mapId: z.number().int(),
  gameStartTime: z.number().int(),
  gameLength: z.number().int(),
  platformId: z.string(),
  bannedChampions: z.array(
    z.object({
      championId: z.number().int(),
      teamId: z.number().int(),
      pickTurn: z.number().int(),
    }),
  ),
  participants: z.array(
    z.object({
      puuid: z.string().nullable(),
      riotId: z.string().optional(),
      teamId: z.number().int(),
      championId: z.number().int(),
      spell1Id: z.number().int(),
      spell2Id: z.number().int(),
      bot: z.boolean(),
      perks: z
        .object({
          perkIds: z.array(z.number().int()),
          perkStyle: z.number().int(),
          perkSubStyle: z.number().int(),
        })
        .optional(),
    }),
  ),
});

export type RiotAccountDto = z.infer<typeof accountSchema>;
export type SummonerDto = z.infer<typeof summonerSchema>;
export type LeagueEntryDto = z.infer<typeof leagueEntrySchema>;
export type ChampionMasteryDto = z.infer<typeof championMasterySchema>;
export type MatchDto = z.infer<typeof matchSchema>;
export type MatchParticipantDto = z.infer<typeof matchParticipantSchema>;
export type MatchTimelineDto = z.infer<typeof matchTimelineSchema>;
export type ActiveGameDto = z.infer<typeof activeGameSchema>;
