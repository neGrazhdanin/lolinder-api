import { describe, expect, it } from 'vitest';
import { type MatchDto, matchSchema } from '../riot/riot.schemas.js';
import { toMatchRecord } from './match-record.js';

function dto(
  info: Record<string, unknown> = {},
  participant: Record<string, unknown> = {},
): MatchDto {
  return matchSchema.parse({
    metadata: { matchId: 'EUW1_7000000001', participants: ['p1'] },
    info: {
      platformId: 'EUW1',
      queueId: 450,
      gameVersion: '16.21.715.1234',
      gameStartTimestamp: Date.parse('2026-10-20T12:00:00.000Z'),
      gameEndTimestamp: Date.parse('2026-10-20T12:20:00.000Z'),
      gameDuration: 1200,
      teams: [
        { teamId: 100, win: false },
        { teamId: 200, win: true },
      ],
      participants: [
        {
          participantId: 1,
          puuid: 'p1',
          riotIdGameName: 'Faker',
          riotIdTagline: 'KR1',
          teamId: 100,
          championId: 7,
          champLevel: 18,
          teamPosition: '',
          win: false,
          kills: 1,
          deaths: 2,
          assists: 3,
          totalDamageDealtToChampions: 4,
          goldEarned: 5,
          totalMinionsKilled: 6,
          neutralMinionsKilled: 7,
          visionScore: 8,
          item0: 1,
          item1: 2,
          item2: 3,
          item3: 4,
          item4: 5,
          item5: 6,
          item6: 7,
          summoner1Id: 4,
          summoner2Id: 32,
          perks: {},
          ...participant,
        },
      ],
      ...info,
    },
  });
}

describe('toMatchRecord', () => {
  it('maps a match and its participants onto rows', () => {
    const { match, participants } = toMatchRecord(dto());

    expect(match).toMatchObject({
      matchId: 'EUW1_7000000001',
      platform: 'euw1',
      patch: '16.21',
      durationSec: 1200,
      winnerTeam: 200,
      remake: false,
    });
    expect(participants[0]).toMatchObject({
      gameName: 'Faker',
      tagLine: 'KR1',
      queueId: 450,
      startedAt: new Date('2026-10-20T12:00:00.000Z'),
      role: null,
      cs: 13,
      items: [1, 2, 3, 4, 5, 6, 7],
      summonerSpells: [4, 32],
      runes: { primaryStyle: null, subStyle: null, perks: [], statPerks: [] },
    });
  });

  it('reads the duration in milliseconds before patch 11.20', () => {
    const { match } = toMatchRecord(dto({ gameEndTimestamp: undefined, gameDuration: 1_234_567 }));

    expect(match.durationSec).toBe(1235);
  });

  it('keeps the Arena duo and finish, and drops them in team modes', () => {
    const arena = toMatchRecord(dto({ queueId: 1700 }, { playerSubteamId: 3, placement: 2 }));
    const draft = toMatchRecord(dto({}, { playerSubteamId: 0, placement: 0 }));

    expect(arena.participants[0]).toMatchObject({ subteamId: 3, placement: 2 });
    expect(draft.participants[0]).toMatchObject({ subteamId: null, placement: null });
  });

  it('drops the zeros Arena sends instead of runes', () => {
    const style = (description: string) => ({ description, style: 0, selections: [{ perk: 0 }] });
    const { participants } = toMatchRecord(
      dto(
        { queueId: 1700 },
        {
          perks: {
            statPerks: { offense: 0, flex: 0, defense: 0 },
            styles: [style('primaryStyle'), style('subStyle')],
          },
        },
      ),
    );

    expect(participants[0]?.runes).toEqual({
      primaryStyle: null,
      subStyle: null,
      perks: [],
      statPerks: [],
    });
  });

  it('marks early surrenders as remakes', () => {
    const { match } = toMatchRecord(dto({}, { gameEndedInEarlySurrender: true }));

    expect(match.remake).toBe(true);
  });

  it('keeps bots without a Riot ID', () => {
    const { participants } = toMatchRecord(
      dto({}, { puuid: 'BOT', riotIdGameName: '', riotIdTagline: undefined }),
    );

    expect(participants[0]).toMatchObject({ puuid: 'BOT', gameName: null, tagLine: null });
  });
});
