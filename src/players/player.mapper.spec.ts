import { describe, expect, it } from 'vitest';
import type { RiotAccount } from '../generated/prisma/client.js';
import { toPlayer } from './player.mapper.js';

const account: RiotAccount = {
  puuid: 'p'.repeat(78),
  gameName: 'Faker',
  tagLine: 'KR1',
  riotIdKey: 'faker#kr1',
  platform: 'kr',
  profileIconId: 6,
  summonerLevel: 800,
  lastSyncedAt: new Date('2026-10-25T10:00:00.000Z'),
  createdAt: new Date('2026-10-20T00:00:00.000Z'),
  updatedAt: new Date('2026-10-25T10:00:00.000Z'),
};

describe('toPlayer', () => {
  it('exposes only contract fields, with ISO dates', () => {
    expect(toPlayer(account)).toEqual({
      puuid: 'p'.repeat(78),
      gameName: 'Faker',
      tagLine: 'KR1',
      platform: 'kr',
      profileIconId: 6,
      summonerLevel: 800,
      lastSyncedAt: '2026-10-25T10:00:00.000Z',
    });
  });

  it('keeps never-synced accounts as null', () => {
    expect(toPlayer({ ...account, lastSyncedAt: null }).lastSyncedAt).toBeNull();
  });

  it('refuses a platform outside the known list', () => {
    expect(() => toPlayer({ ...account, platform: 'xx1' })).toThrow();
  });
});
