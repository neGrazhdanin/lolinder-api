import { type INestApplicationContext, Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import nock from 'nock';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { createFastifyAdapter } from '../src/bootstrap/fastify-adapter.js';
import { CoreModule } from '../src/core/core.module.js';
import { InfraModule } from '../src/infra/infra.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { MatchHistorySync } from '../src/matches/match-history.sync.js';
import type { MatchHistoryPage } from '../src/matches/matches.schemas.js';
import { MatchesWorkerModule } from '../src/matches/matches-worker.module.js';
import { RealtimeEmitter } from '../src/realtime/realtime.emitter.js';
import { riotIdKey } from '../src/riot/riot-id.js';
import { matchTimes, riotMatch } from './fixtures/matches.js';

// All tests that touch the `matches` queue live in this file, for the same reason as in players.e2e-spec.
const puuid = (seed: string) => `mh-${seed}`.padEnd(78, 'x');
// Own region and generous limits: the Riot limiter windows live in the Redis all e2e files share.
const sea = () =>
  nock('https://sea.api.riotgames.com').defaultReplyHeaders({
    'X-App-Rate-Limit': '1000:1,100000:120',
    'X-Method-Rate-Limit': '1000:1',
  });
const NEWEST = new Date('2026-10-20T12:00:00.000Z');
const JOB_POLL = { timeout: 5000 };
const IDLE = { newest: false, older: false };

type RiotMatch = ReturnType<typeof riotMatch>;

function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`No item at ${index}`);
  }
  return item;
}

function buildMatches(seed: string, times: Date[], first = 1, queueOf?: (i: number) => number) {
  return times.map((startedAt, i) =>
    riotMatch({
      matchId: `OC1_${seed.length}${String(first + i).padStart(6, '0')}${seed.charCodeAt(0)}`,
      startedAt,
      puuid: puuid(seed),
      queueId: queueOf?.(i),
      win: i % 2 === 0,
    }),
  );
}

function mockIds(seed: string, matches: RiotMatch[], query: Record<string, string>) {
  sea()
    .get(`/lol/match/v5/matches/by-puuid/${puuid(seed)}/ids`)
    .query(query)
    .reply(
      200,
      matches.map((match) => match.metadata.matchId),
    );
}

function mockDetails(matches: RiotMatch[]) {
  for (const match of matches) {
    sea().get(`/lol/match/v5/matches/${match.metadata.matchId}`).reply(200, match);
  }
}

describe('matches (e2e)', () => {
  let app: NestFastifyApplication;
  let worker: INestApplicationContext;
  let prisma: PrismaService;
  let matchesUpdated: ReturnType<typeof vi.spyOn>;

  const history = (seed: string, query: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url: `/players/${puuid(seed)}/matches`, query });
  const settledHistory = async (seed: string, query: Record<string, string> = {}) => {
    await expect
      .poll(async () => (await history(seed, query)).json().loading, JOB_POLL)
      .toEqual(IDLE);
    return (await history(seed, query)).json<MatchHistoryPage>();
  };
  const createAccount = (seed: string, run: Record<string, unknown> = {}) =>
    prisma.riotAccount.create({
      data: {
        puuid: puuid(seed),
        gameName: seed,
        tagLine: 'OCE',
        riotIdKey: riotIdKey(seed, 'OCE'),
        platform: 'oc1',
        lastSyncedAt: new Date(),
        ...run,
      },
    });

  beforeAll(async () => {
    nock.disableNetConnect();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);

    const workerRef = await Test.createTestingModule({
      imports: [CoreModule, InfraModule, MatchesWorkerModule],
    }).compile();
    worker = await workerRef.init();
    matchesUpdated = vi.spyOn(worker.get(RealtimeEmitter), 'playerMatchesUpdated');
  });

  afterEach(async () => {
    await expect.poll(() => nock.pendingMocks(), JOB_POLL).toEqual([]);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('history', () => {
    it('loads the newest matches on the first visit', async () => {
      await createAccount('first');
      const matches = buildMatches('first', matchTimes(3, NEWEST));
      mockIds('first', matches, { count: '20' });
      mockDetails(matches);

      const res = await history('first');

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        items: [],
        nextCursor: null,
        loading: { newest: true, older: false },
      });
      const page = await settledHistory('first');
      expect(page.nextCursor).toBeNull();
      expect(page.items.map((item: { matchId: string }) => item.matchId)).toEqual(
        matches.map((match) => match.metadata.matchId),
      );
      expect(page.items[0]).toEqual({
        matchId: nth(matches, 0).metadata.matchId,
        queueId: 420,
        patch: '16.21',
        startedAt: NEWEST.toISOString(),
        durationSec: 1800,
        remake: false,
        teamId: 100,
        subteamId: null,
        placement: null,
        championId: 100,
        champLevel: 16,
        role: 'TOP',
        kills: 5,
        deaths: 3,
        assists: 8,
        damageToChampions: 21_000,
        goldEarned: 11_000,
        cs: 200,
        visionScore: 30,
        items: [3089, 3020, 0, 0, 0, 0, 3340],
        summonerSpells: [4, 14],
        runes: {
          primaryStyle: 8100,
          subStyle: 8300,
          perks: [8112, 8139, 8138, 8135, 8304, 8345],
          statPerks: [5008, 5008, 5011],
        },
        win: true,
        participants: expect.any(Array),
      });
      expect(nth(page.items, 0).participants).toHaveLength(10);
      expect(nth(page.items, 0).participants[5]).toEqual({
        puuid: expect.any(String),
        gameName: 'Player6',
        tagLine: 'OCE',
        teamId: 200,
        subteamId: null,
        championId: 105,
      });
      expect(matchesUpdated).toHaveBeenCalledWith({ puuid: puuid('first') });
    });

    it('answers a repeated visit from the database while the list is fresh', async () => {
      const res = await history('first');

      expect(res.json()).toMatchObject({ loading: IDLE, nextCursor: null });
      expect(res.json().items).toHaveLength(3);
    });

    it('syncs the newest matches again after the profile synced', async () => {
      const newer = nth(buildMatches('first', [new Date(NEWEST.getTime() + 3_600_000)], 100), 0);
      const known = buildMatches('first', matchTimes(3, NEWEST));
      mockIds('first', [newer, ...known], { count: '20' });
      mockDetails([newer]);
      await prisma.riotAccount.update({
        where: { puuid: puuid('first') },
        data: { lastSyncedAt: new Date() },
      });

      expect((await history('first')).json().loading).toEqual({ newest: true, older: false });
      const page = await settledHistory('first');
      expect(page.items).toHaveLength(4);
      expect(nth(page.items, 0).matchId).toBe(newer.metadata.matchId);
    });

    it('pages with a cursor and filters by queue', async () => {
      await createAccount('pages');
      const matches = buildMatches('pages', matchTimes(5, NEWEST), 1, (i) =>
        i % 2 === 1 ? 440 : 420,
      );
      mockIds('pages', matches, { count: '20' });
      mockDetails(matches);
      await settledHistory('pages');

      const ids: string[] = [];
      const query: Record<string, string> = { limit: '2' };
      let pages = 0;
      for (;;) {
        const page = (await history('pages', query)).json<MatchHistoryPage>();
        ids.push(...page.items.map((item) => item.matchId));
        pages++;
        if (!page.nextCursor) {
          break;
        }
        query.cursor = page.nextCursor;
      }
      expect(pages).toBe(3);
      expect(ids).toEqual(matches.map((match) => match.metadata.matchId));

      const flex = (await history('pages', { queue: 'flex' })).json();
      expect(flex.items.map((item: { queueId: number }) => item.queueId)).toEqual([440, 440]);
    });

    it('loads one older batch per page past the stored matches', async () => {
      await createAccount('older');
      const times = matchTimes(45, NEWEST);
      const matches = buildMatches('older', times);
      const olderIds = (oldestKnown: number, slice: RiotMatch[]) =>
        mockIds('older', slice, {
          start: '0',
          count: '20',
          endTime: String(Math.floor((nth(times, oldestKnown).getTime() + 2 * 3_600_000) / 1000)),
        });
      mockIds('older', matches.slice(0, 20), { count: '20' });
      mockDetails(matches.slice(0, 20));
      // Each batch overlaps the stored matches by two hours: two IDs come back already stored.
      olderIds(19, matches.slice(18, 38));
      mockDetails(matches.slice(20, 38));
      olderIds(37, matches.slice(36));
      mockDetails(matches.slice(38));
      const matchIds = (page: MatchHistoryPage) => page.items.map((item) => item.matchId);
      const expectIds = (from: number, to: number) =>
        matches.slice(from, to).map((match) => match.metadata.matchId);

      const first = await settledHistory('older');
      expect(matchIds(first)).toEqual(expectIds(0, 20));
      expect(first.nextCursor).not.toBeNull();

      const cursor = { cursor: first.nextCursor ?? '' };
      expect((await history('older', cursor)).json()).toMatchObject({
        loading: { newest: false, older: true },
        nextCursor: null,
      });
      // Polling refetches this page after the batch; a second batch would hit an unmocked Riot call.
      const second = await settledHistory('older', cursor);
      expect(matchIds(second)).toEqual(expectIds(20, 38));
      expect(second.nextCursor).not.toBeNull();

      const third = await settledHistory('older', { cursor: second.nextCursor ?? '' });
      expect(matchIds(third)).toEqual(expectIds(38, 45));
      expect(third.nextCursor).toBeNull();
      expect(
        await prisma.riotAccount.findUnique({ where: { puuid: puuid('older') } }),
      ).toMatchObject({ matchHistoryFrom: times[44], matchHistoryComplete: true });
    });

    it('rejects an unknown player and a malformed cursor', async () => {
      expect((await history('nobody')).json()).toEqual({ code: 'PLAYER_NOT_FOUND' });
      const res = await history('first', { cursor: 'not-a-cursor' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ path: 'cursor' }],
      });
    });
  });

  describe('newest matches sync', () => {
    it('restarts the run after more than a batch of new games', async () => {
      const old = new Date('2026-09-01T12:00:00.000Z');
      await createAccount('gap', {
        matchHistoryFrom: old,
        matchHistoryTo: old,
        matchHistoryComplete: true,
      });
      const times = matchTimes(20, NEWEST);
      const matches = buildMatches('gap', times);
      mockIds('gap', matches, { count: '20' });
      mockDetails(matches);

      await worker.get(MatchHistorySync).syncNewest(puuid('gap'));

      expect(await prisma.riotAccount.findUnique({ where: { puuid: puuid('gap') } })).toMatchObject(
        {
          matchHistoryFrom: times[19],
          matchHistoryTo: NEWEST,
          matchHistoryComplete: false,
        },
      );
    });

    it('joins a batch that reaches the run and skips stored matches', async () => {
      const times = matchTimes(20, new Date(NEWEST.getTime() + 15 * 3_600_000));
      const matches = buildMatches('gap', times, 50);
      // The five oldest IDs of this batch are the newest five already stored.
      const known = buildMatches('gap', matchTimes(5, NEWEST));
      mockIds('gap', [...matches.slice(0, 15), ...known], { count: '20' });
      mockDetails(matches.slice(0, 15));

      await worker.get(MatchHistorySync).syncNewest(puuid('gap'));

      expect(await prisma.riotAccount.findUnique({ where: { puuid: puuid('gap') } })).toMatchObject(
        { matchHistoryFrom: matchTimes(20, NEWEST)[19], matchHistoryTo: times[0] },
      );
    });
  });

  describe('match page', () => {
    it('returns every participant of a stored match', async () => {
      const match = nth(buildMatches('first', matchTimes(1, NEWEST)), 0);
      const res = await app.inject({ method: 'GET', url: `/matches/${match.metadata.matchId}` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        matchId: match.metadata.matchId,
        platform: 'oc1',
        queueId: 420,
        winnerTeam: 100,
        remake: false,
      });
      expect(
        res.json().participants.map((p: { participantId: number }) => p.participantId),
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(res.json().participants[0]).toMatchObject({
        puuid: puuid('first'),
        gameName: 'Player1',
      });
    });

    it('answers MATCH_NOT_FOUND for a match that was never stored', async () => {
      const res = await app.inject({ method: 'GET', url: '/matches/OC1_1' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'MATCH_NOT_FOUND' });
    });

    it('rejects a malformed match ID', async () => {
      const res = await app.inject({ method: 'GET', url: '/matches/not-a-match' });

      expect(res.statusCode).toBe(400);
    });
  });
});
