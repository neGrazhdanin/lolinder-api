export interface RiotMatchOptions {
  matchId: string;
  startedAt: Date;
  puuid: string;
  queueId?: number;
  win?: boolean;
  remake?: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

export function matchTimes(count: number, newest: Date, stepMs = HOUR_MS): Date[] {
  return Array.from({ length: count }, (_, i) => new Date(newest.getTime() - i * stepMs));
}

export function riotMatch({
  matchId,
  startedAt,
  puuid,
  queueId = 420,
  win = true,
  remake = false,
}: RiotMatchOptions) {
  const participants = Array.from({ length: 10 }, (_, i) => {
    const teamId = i < 5 ? 100 : 200;
    return {
      participantId: i + 1,
      puuid: i === 0 ? puuid : `${matchId}-${i}`.padEnd(78, 'o'),
      riotIdGameName: `Player${i + 1}`,
      riotIdTagline: 'OCE',
      teamId,
      championId: 100 + i,
      champLevel: 16,
      teamPosition: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][i % 5],
      win: teamId === 100 ? win : !win,
      kills: 5,
      deaths: 3,
      assists: 8,
      totalDamageDealtToChampions: 21_000,
      goldEarned: 11_000,
      totalMinionsKilled: 180,
      neutralMinionsKilled: 20,
      visionScore: 30,
      item0: 3089,
      item1: 3020,
      item2: 0,
      item3: 0,
      item4: 0,
      item5: 0,
      item6: 3340,
      summoner1Id: 4,
      summoner2Id: 14,
      gameEndedInEarlySurrender: remake,
      perks: {
        statPerks: { offense: 5008, flex: 5008, defense: 5011 },
        styles: [
          {
            description: 'primaryStyle',
            style: 8100,
            selections: [{ perk: 8112 }, { perk: 8139 }, { perk: 8138 }, { perk: 8135 }],
          },
          { description: 'subStyle', style: 8300, selections: [{ perk: 8304 }, { perk: 8345 }] },
        ],
      },
    };
  });
  return {
    metadata: { matchId, dataVersion: '2', participants: participants.map((p) => p.puuid) },
    info: {
      platformId: 'OC1',
      queueId,
      gameMode: 'CLASSIC',
      gameVersion: '16.21.715.1234',
      gameStartTimestamp: startedAt.getTime(),
      gameEndTimestamp: startedAt.getTime() + 1800_000,
      gameDuration: 1800,
      participants,
      teams: [
        { teamId: 100, win },
        { teamId: 200, win: !win },
      ],
    },
  };
}
