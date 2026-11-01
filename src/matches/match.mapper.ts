import type { MatchParticipant, Match as MatchRow } from '../generated/prisma/client.js';
import { type Match, type MatchHistoryItem, matchRunesSchema } from './matches.schemas.js';

type HistoryParticipant = Pick<
  MatchParticipant,
  'puuid' | 'gameName' | 'tagLine' | 'teamId' | 'subteamId' | 'championId'
>;

export type MatchHistoryRow = MatchParticipant & {
  match: Pick<MatchRow, 'patch' | 'durationSec' | 'remake'> & {
    participants: HistoryParticipant[];
  };
};

export function toMatchHistoryItem(row: MatchHistoryRow): MatchHistoryItem {
  return {
    matchId: row.matchId,
    queueId: row.queueId,
    patch: row.match.patch,
    startedAt: row.startedAt.toISOString(),
    durationSec: row.match.durationSec,
    remake: row.match.remake,
    ...toStats(row),
    participants: row.match.participants.map((participant) => ({
      puuid: participant.puuid,
      gameName: participant.gameName,
      tagLine: participant.tagLine,
      teamId: participant.teamId,
      subteamId: participant.subteamId,
      championId: participant.championId,
    })),
  };
}

export function toMatch(
  match: Omit<MatchRow, 'rawJson'> & { participants: MatchParticipant[] },
): Match {
  return {
    matchId: match.matchId,
    platform: match.platform,
    queueId: match.queueId,
    patch: match.patch,
    startedAt: match.startedAt.toISOString(),
    durationSec: match.durationSec,
    remake: match.remake,
    winnerTeam: match.winnerTeam,
    participants: match.participants.map((participant) => ({
      participantId: participant.participantId,
      puuid: participant.puuid,
      gameName: participant.gameName,
      tagLine: participant.tagLine,
      ...toStats(participant),
    })),
  };
}

function toStats(participant: MatchParticipant) {
  return {
    teamId: participant.teamId,
    subteamId: participant.subteamId,
    placement: participant.placement,
    championId: participant.championId,
    champLevel: participant.champLevel,
    role: participant.role,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    damageToChampions: participant.damageToChampions,
    goldEarned: participant.goldEarned,
    cs: participant.cs,
    visionScore: participant.visionScore,
    items: participant.items,
    summonerSpells: participant.summonerSpells,
    runes: matchRunesSchema.parse(participant.runes),
    win: participant.win,
  };
}
