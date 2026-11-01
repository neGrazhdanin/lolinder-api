import { describe, expect, it } from 'vitest';
import type { RiotAccount } from '../generated/prisma/client.js';
import { toPlayer, toPlayerProfile } from './player.mapper.js';

const now = new Date('2026-10-25T10:05:00.000Z').getTime();

const account: RiotAccount = {
  puuid: 'p'.repeat(78),
  gameName: 'Faker',
  tagLine: 'KR1',
  riotIdKey: 'faker#kr1',
  platform: 'kr',
  profileIconId: 6,
  summonerLevel: 800,
  ranks: [
    {
      queue: 'solo',
      tier: 'CHALLENGER',
      division: 'I',
      leaguePoints: 1500,
      wins: 300,
      losses: 200,
    },
  ],
  topMasteries: [
    { championId: 7, level: 50, points: 1_000_000, lastPlayedAt: '2026-10-24T12:00:00.000Z' },
  ],
  lastSyncedAt: new Date('2026-10-25T10:00:00.000Z'),
  matchHistoryFrom: null,
  matchHistoryTo: null,
  matchHistoryComplete: false,
  matchHistorySyncedAt: null,
  createdAt: new Date('2026-10-20T00:00:00.000Z'),
  updatedAt: new Date('2026-10-25T10:00:00.000Z'),
};

describe('toPlayer', () => {
  it('exposes only contract fields, with ISO dates', () => {
    expect(toPlayer(account, false, now)).toEqual({
      puuid: 'p'.repeat(78),
      gameName: 'Faker',
      tagLine: 'KR1',
      platform: 'kr',
      profileIconId: 6,
      summonerLevel: 800,
      sync: { status: 'fresh', lastSyncedAt: '2026-10-25T10:00:00.000Z' },
    });
  });

  it.each([
    ['a queued sync', account.lastSyncedAt, true, 'syncing'],
    ['data older than ten minutes', new Date('2026-10-25T09:55:00.000Z'), false, 'stale'],
    ['a player that was never synced', null, false, 'stale'],
  ] as const)('reports %s as %s', (_, lastSyncedAt, syncing, status) => {
    expect(toPlayer({ ...account, lastSyncedAt }, syncing, now).sync.status).toBe(status);
  });

  it('refuses a platform outside the known list', () => {
    expect(() => toPlayer({ ...account, platform: 'xx1' }, false, now)).toThrow();
  });
});

describe('toPlayerProfile', () => {
  it('adds the stored ranks and masteries', () => {
    const profile = toPlayerProfile(account, false, now);
    expect(profile.ranks).toEqual(account.ranks);
    expect(profile.topMasteries).toEqual(account.topMasteries);
  });

  it('shows a never-synced player with empty lists', () => {
    const profile = toPlayerProfile({ ...account, ranks: null, topMasteries: null }, false, now);
    expect(profile.ranks).toEqual([]);
    expect(profile.topMasteries).toEqual([]);
  });
});
