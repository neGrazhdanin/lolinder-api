import type { Prisma } from '../generated/prisma/client.js';
import type { MatchDto, MatchParticipantDto } from '../riot/riot.schemas.js';
import type { MatchRunes } from './matches.schemas.js';

export interface MatchRecord {
  match: Prisma.MatchCreateManyInput & { startedAt: Date };
  participants: Prisma.MatchParticipantCreateManyInput[];
}

export function toMatchRecord(dto: MatchDto): MatchRecord {
  const { info } = dto;
  const startedAt = new Date(info.gameStartTimestamp);
  const durationSec =
    info.gameEndTimestamp === undefined ? Math.round(info.gameDuration / 1000) : info.gameDuration;
  return {
    match: {
      matchId: dto.metadata.matchId,
      platform: info.platformId.toLowerCase(),
      queueId: info.queueId,
      gameVersion: info.gameVersion,
      patch: info.gameVersion.split('.').slice(0, 2).join('.'),
      startedAt,
      durationSec,
      winnerTeam: info.teams.find((team) => team.win)?.teamId ?? null,
      remake: info.participants.some((participant) => participant.gameEndedInEarlySurrender),
      rawJson: dto as Prisma.InputJsonValue,
    },
    participants: info.participants.map((participant) => ({
      matchId: dto.metadata.matchId,
      participantId: participant.participantId,
      puuid: participant.puuid,
      gameName: participant.riotIdGameName || null,
      tagLine: participant.riotIdTagline || null,
      queueId: info.queueId,
      startedAt,
      teamId: participant.teamId,
      // Riot sends 0 outside Arena.
      subteamId: participant.playerSubteamId || null,
      placement: participant.placement || null,
      championId: participant.championId,
      champLevel: participant.champLevel,
      // Empty outside Summoner's Rift.
      role: participant.teamPosition || null,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      damageToChampions: participant.totalDamageDealtToChampions,
      goldEarned: participant.goldEarned,
      cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
      visionScore: participant.visionScore,
      items: [
        participant.item0,
        participant.item1,
        participant.item2,
        participant.item3,
        participant.item4,
        participant.item5,
        participant.item6,
      ],
      summonerSpells: [participant.summoner1Id, participant.summoner2Id],
      runes: toRunes(participant.perks),
      win: participant.win,
    })),
  };
}

// Modes without runes, such as Arena, send zeros in every rune field.
function toRunes(perks: MatchParticipantDto['perks']): MatchRunes {
  const primary = perks.styles.find((style) => style.description === 'primaryStyle');
  const sub = perks.styles.find((style) => style.description === 'subStyle');
  const selections = [primary, sub].flatMap((style) => style?.selections ?? []);
  const shards = perks.statPerks;
  return {
    primaryStyle: primary?.style || null,
    subStyle: sub?.style || null,
    perks: selections.map((selection) => selection.perk).filter(Boolean),
    statPerks: (shards ? [shards.offense, shards.flex, shards.defense] : []).filter(Boolean),
  };
}
