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
import { PlayersWorkerModule } from '../src/players/players-worker.module.js';
import { RealtimeEmitter } from '../src/realtime/realtime.emitter.js';
import { riotIdKey } from '../src/riot/riot-id.js';

// All tests that touch the `players` queue live in this file: Vitest runs files in separate processes,
// and a job picked up by another file's worker would not see this file's nock mocks.
// Names are unique to this file: other e2e files share the database and store their own accounts.
const puuid = (seed: string) => seed.padEnd(78, 'x');
const byRiotId = (gameName: string, tagLine: string) =>
  `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
const riot = (host: string) => nock(`https://${host}.api.riotgames.com`);
// A sync is four Riot calls and a transaction; CI runners need more than the default second.
const SYNC_POLL = { timeout: 5000 };

function summoner(platform: string, seed: string, profileIconId = 29, summonerLevel = 100) {
  return riot(platform)
    .get(`/lol/summoner/v4/summoners/by-puuid/${puuid(seed)}`)
    .reply(200, { puuid: puuid(seed), profileIconId, revisionDate: 1, summonerLevel });
}

interface SyncMock {
  platform: string;
  region: string;
  seed: string;
  gameName: string;
  tagLine: string;
  leaguePoints?: number;
  leagueStatus?: number;
}

/** The four Riot calls of one player sync. */
function mockSync({
  platform,
  region,
  seed,
  gameName,
  tagLine,
  leaguePoints = 50,
  leagueStatus = 200,
}: SyncMock) {
  const id = puuid(seed);
  riot(region)
    .get(`/riot/account/v1/accounts/by-puuid/${id}`)
    .reply(200, { puuid: id, gameName, tagLine });
  summoner(platform, seed, 7, 300);
  riot(platform)
    .get(`/lol/league/v4/entries/by-puuid/${id}`)
    .reply(
      leagueStatus,
      leagueStatus === 200
        ? [
            {
              puuid: id,
              queueType: 'RANKED_SOLO_5x5',
              tier: 'GOLD',
              rank: 'II',
              leaguePoints,
              wins: 10,
              losses: 8,
            },
            {
              puuid: id,
              queueType: 'CHERRY',
              tier: 'GOLD',
              rank: 'I',
              leaguePoints: 0,
              wins: 1,
              losses: 1,
            },
            // Seen on live Riot data: event queues with tiers outside the ranked ladder.
            {
              puuid: id,
              queueType: 'JADE_RANKED_SOLO_5x5',
              tier: 'WOOD',
              rank: 'IV',
              leaguePoints: 15,
              wins: 6,
              losses: 3,
            },
          ]
        : undefined,
    );
  riot(platform)
    .get(`/lol/champion-mastery/v4/champion-masteries/by-puuid/${id}/top`)
    .query({ count: '10' })
    .reply(200, [
      {
        puuid: id,
        championId: 7,
        championLevel: 12,
        championPoints: 150_000,
        lastPlayTime: Date.parse('2026-10-24T12:00:00.000Z'),
      },
    ]);
}

describe('players (e2e)', () => {
  let app: NestFastifyApplication;
  let worker: INestApplicationContext;
  let prisma: PrismaService;
  let playerUpdated: ReturnType<typeof vi.spyOn>;

  const search = (platform: string, gameName: string, tagLine: string) =>
    app.inject({ method: 'GET', url: '/players/search', query: { platform, gameName, tagLine } });
  const profile = (seed: string) => app.inject({ method: 'GET', url: `/players/${puuid(seed)}` });
  const refresh = (seed: string) =>
    app.inject({ method: 'POST', url: `/players/${puuid(seed)}/refresh` });
  const syncStatus = async (seed: string) => (await profile(seed)).json().sync.status;
  const markSyncedAgo = (seed: string, ms: number) =>
    prisma.riotAccount.update({
      where: { puuid: puuid(seed) },
      data: { lastSyncedAt: new Date(Date.now() - ms) },
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
      imports: [CoreModule, InfraModule, PlayersWorkerModule],
    }).compile();
    worker = await workerRef.init();
    playerUpdated = vi.spyOn(worker.get(RealtimeEmitter), 'playerUpdated');
  });

  afterEach(async () => {
    // Syncs queued by a test finish in the background; every mocked Riot call must be used.
    await expect.poll(() => nock.pendingMocks(), { timeout: 5000 }).toEqual([]);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('search', () => {
    it('resolves an unknown Riot ID through the worker and starts a full sync', async () => {
      riot('europe')
        .get(byRiotId('zeus', 'kr1'))
        .reply(200, { puuid: puuid('zeus'), gameName: 'Zeus', tagLine: 'KR1' });
      summoner('euw1', 'zeus', 4568, 512);
      mockSync({
        platform: 'euw1',
        region: 'europe',
        seed: 'zeus',
        gameName: 'Zeus',
        tagLine: 'KR1',
      });

      const res = await search('euw1', 'zeus', 'kr1');

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        puuid: puuid('zeus'),
        gameName: 'Zeus',
        tagLine: 'KR1',
        platform: 'euw1',
        profileIconId: 4568,
        summonerLevel: 512,
        sync: { status: 'syncing', lastSyncedAt: null },
      });
      expect(
        await prisma.riotAccount.findUnique({ where: { puuid: puuid('zeus') } }),
      ).toMatchObject({ riotIdKey: 'zeus#kr1', platform: 'euw1' });
      await expect.poll(() => syncStatus('zeus'), SYNC_POLL).toBe('fresh');
      // The event follows the commit, so it can land a moment after the data is visible.
      await expect.poll(() => playerUpdated.mock.calls).toContainEqual([{ puuid: puuid('zeus') }]);
    });

    it('serves a repeated search from the database regardless of case', async () => {
      const res = await search('euw1', 'ZEUS', 'Kr1');

      expect(res.statusCode).toBe(200);
      expect(res.json().puuid).toBe(puuid('zeus'));
    });

    it('accepts the tag line with its leading #', async () => {
      const res = await search('euw1', 'Zeus', '#KR1');

      expect(res.statusCode).toBe(200);
      expect(res.json().puuid).toBe(puuid('zeus'));
    });

    it('answers PLAYER_NOT_FOUND and remembers it without asking Riot again', async () => {
      riot('europe').get(byRiotId('nobody', 'euw')).reply(404);

      const first = await search('euw1', 'nobody', 'euw');
      const second = await search('euw1', 'Nobody', 'EUW');

      expect(first.statusCode).toBe(404);
      expect(first.json()).toEqual({ code: 'PLAYER_NOT_FOUND' });
      expect(second.statusCode).toBe(404);
    });

    it('answers PLAYER_NOT_FOUND for a Riot ID that does not play on the chosen platform', async () => {
      riot('americas')
        .get(byRiotId('Zeus', 'KR1'))
        .reply(200, { puuid: puuid('zeus'), gameName: 'Zeus', tagLine: 'KR1' });
      riot('br1')
        .get(`/lol/summoner/v4/summoners/by-puuid/${puuid('zeus')}`)
        .reply(404);

      const res = await search('br1', 'Zeus', 'KR1');

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'PLAYER_NOT_FOUND' });
      expect(
        await prisma.riotAccount.findUnique({ where: { puuid: puuid('zeus') } }),
      ).toMatchObject({ platform: 'euw1' });
    });

    it('shares one Riot lookup between concurrent searches', async () => {
      riot('americas')
        .get(byRiotId('Doublelift', 'NA1'))
        .delay(300)
        .reply(200, { puuid: puuid('doublelift'), gameName: 'Doublelift', tagLine: 'NA1' });
      summoner('na1', 'doublelift');
      mockSync({
        platform: 'na1',
        region: 'americas',
        seed: 'doublelift',
        gameName: 'Doublelift',
        tagLine: 'NA1',
      });

      const results = await Promise.all([
        search('na1', 'Doublelift', 'NA1'),
        search('na1', 'Doublelift', 'NA1'),
      ]);

      expect(results.map((res) => res.statusCode)).toEqual([200, 200]);
    });

    it('refreshes a stored account whose Riot ID now belongs to someone else', async () => {
      await prisma.riotAccount.create({
        data: {
          puuid: puuid('old-chovy'),
          gameName: 'Chovy',
          tagLine: 'KR1',
          riotIdKey: riotIdKey('Chovy', 'KR1'),
          platform: 'kr',
        },
      });
      riot('europe')
        .get(byRiotId('Chovy', 'KR1'))
        .reply(200, { puuid: puuid('new-chovy'), gameName: 'Chovy', tagLine: 'KR1' });
      riot('asia')
        .get(`/riot/account/v1/accounts/by-puuid/${puuid('old-chovy')}`)
        .reply(200, { puuid: puuid('old-chovy'), gameName: 'Renamed', tagLine: 'KR2' });
      summoner('euw1', 'new-chovy');
      mockSync({
        platform: 'euw1',
        region: 'europe',
        seed: 'new-chovy',
        gameName: 'Chovy',
        tagLine: 'KR1',
      });

      const res = await search('euw1', 'Chovy', 'KR1');

      expect(res.json().puuid).toBe(puuid('new-chovy'));
      expect(
        await prisma.riotAccount.findUnique({ where: { puuid: puuid('old-chovy') } }),
      ).toMatchObject({ gameName: 'Renamed', tagLine: 'KR2', riotIdKey: 'renamed#kr2' });
    });

    it('answers SERVICE_UNAVAILABLE when Riot rejects the key, and tries again on the next search', async () => {
      riot('europe').get(byRiotId('Caps', 'EUW')).reply(401);
      riot('europe')
        .get(byRiotId('Caps', 'EUW'))
        .reply(200, { puuid: puuid('caps'), gameName: 'Caps', tagLine: 'EUW' });
      summoner('euw1', 'caps');
      mockSync({
        platform: 'euw1',
        region: 'europe',
        seed: 'caps',
        gameName: 'Caps',
        tagLine: 'EUW',
      });

      const rejected = await search('euw1', 'Caps', 'EUW');
      const retried = await search('euw1', 'Caps', 'EUW');

      expect(rejected.statusCode).toBe(503);
      expect(rejected.json()).toEqual({ code: 'SERVICE_UNAVAILABLE' });
      expect(retried.statusCode).toBe(200);
      expect(retried.json().puuid).toBe(puuid('caps'));
    });

    it.each([
      ['an unknown platform', { platform: 'xx1', gameName: 'Faker', tagLine: 'KR1' }],
      ['a tag line that is too long', { platform: 'kr', gameName: 'Faker', tagLine: 'KOREA1' }],
      ['a tag line with symbols', { platform: 'kr', gameName: 'Faker', tagLine: 'K-1' }],
      ['a game name with #', { platform: 'kr', gameName: 'Faker#KR1', tagLine: 'KR1' }],
    ])('rejects %s', async (_, query) => {
      const res = await app.inject({ method: 'GET', url: '/players/search', query });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('profile', () => {
    it('serves the synced profile with current ranks and top masteries', async () => {
      const res = await profile('zeus');

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        puuid: puuid('zeus'),
        profileIconId: 7,
        summonerLevel: 300,
        ranks: [
          { queue: 'solo', tier: 'GOLD', division: 'II', leaguePoints: 50, wins: 10, losses: 8 },
        ],
        topMasteries: [
          { championId: 7, level: 12, points: 150_000, lastPlayedAt: '2026-10-24T12:00:00.000Z' },
        ],
        sync: { status: 'fresh' },
      });
      expect(await prisma.rankSnapshot.count({ where: { puuid: puuid('zeus') } })).toBe(1);
    });

    it('queues one background sync for a stale profile and snapshots the LP change', async () => {
      await markSyncedAgo('zeus', 11 * 60_000);
      mockSync({
        platform: 'euw1',
        region: 'europe',
        seed: 'zeus',
        gameName: 'Zeus',
        tagLine: 'KR1',
        leaguePoints: 71,
      });

      const views = await Promise.all([profile('zeus'), profile('zeus')]);

      expect(views.map((res) => res.json().sync.status)).toEqual(['syncing', 'syncing']);
      await expect.poll(() => syncStatus('zeus'), SYNC_POLL).toBe('fresh');
      expect((await profile('zeus')).json().ranks[0].leaguePoints).toBe(71);
      expect(await prisma.rankSnapshot.count({ where: { puuid: puuid('zeus') } })).toBe(2);
    });

    it('does not snapshot ranks that did not change', async () => {
      await markSyncedAgo('zeus', 11 * 60_000);
      mockSync({
        platform: 'euw1',
        region: 'europe',
        seed: 'zeus',
        gameName: 'Zeus',
        tagLine: 'KR1',
        leaguePoints: 71,
      });

      await profile('zeus');
      await expect.poll(() => syncStatus('zeus'), SYNC_POLL).toBe('fresh');

      expect(await prisma.rankSnapshot.count({ where: { puuid: puuid('zeus') } })).toBe(2);
    });

    it('serves the LP history oldest first, per queue', async () => {
      const solo = await app.inject({
        method: 'GET',
        url: `/players/${puuid('zeus')}/rank-history`,
      });
      const flex = await app.inject({
        method: 'GET',
        url: `/players/${puuid('zeus')}/rank-history?queue=flex`,
      });

      expect(solo.statusCode).toBe(200);
      expect(
        solo.json().items.map((point: { leaguePoints: number }) => point.leaguePoints),
      ).toEqual([50, 71]);
      expect(solo.json().items[0]).toEqual({
        takenAt: expect.any(String),
        tier: 'GOLD',
        division: 'II',
        leaguePoints: 50,
        wins: 10,
        losses: 8,
      });
      expect(flex.json()).toEqual({ items: [] });
    });

    it('answers a refresh right after a sync from the database', async () => {
      const res = await refresh('zeus');

      expect(res.statusCode).toBe(200);
      expect(res.json().sync.status).toBe('fresh');
    });

    it('queues a user sync on refresh once the cooldown has passed', async () => {
      await markSyncedAgo('zeus', 3 * 60_000);
      mockSync({
        platform: 'euw1',
        region: 'europe',
        seed: 'zeus',
        gameName: 'Zeus',
        tagLine: 'KR1',
        leaguePoints: 71,
      });

      const res = await refresh('zeus');

      expect(res.json().sync.status).toBe('syncing');
      await expect.poll(() => syncStatus('zeus'), SYNC_POLL).toBe('fresh');
    });

    it('still emits player:updated when a sync gives up', async () => {
      await markSyncedAgo('doublelift', 11 * 60_000);
      mockSync({
        platform: 'na1',
        region: 'americas',
        seed: 'doublelift',
        gameName: 'Doublelift',
        tagLine: 'NA1',
        leagueStatus: 403,
      });
      playerUpdated.mockClear();

      expect((await profile('doublelift')).json().sync.status).toBe('syncing');

      await expect.poll(() => playerUpdated.mock.calls).toEqual([[{ puuid: puuid('doublelift') }]]);
      // Views right after a failure do not queue the same failing sync again.
      expect(await syncStatus('doublelift')).toBe('stale');
      expect((await refresh('doublelift')).json().sync.status).toBe('syncing');
      mockSync({
        platform: 'na1',
        region: 'americas',
        seed: 'doublelift',
        gameName: 'Doublelift',
        tagLine: 'NA1',
      });
      await expect.poll(() => syncStatus('doublelift'), SYNC_POLL).toBe('fresh');
    });

    it.each([
      ['an unknown player', `/players/${puuid('ghost')}`, 404, 'PLAYER_NOT_FOUND'],
      ['a malformed puuid', '/players/not-a-puuid', 400, 'VALIDATION_FAILED'],
      [
        'LP history of an unknown player',
        `/players/${puuid('ghost')}/rank-history`,
        404,
        'PLAYER_NOT_FOUND',
      ],
      [
        'an unknown queue',
        `/players/${puuid('zeus')}/rank-history?queue=aram`,
        400,
        'VALIDATION_FAILED',
      ],
    ])('rejects %s', async (_, url, status, code) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(status);
      expect(res.json()).toMatchObject({ code });
    });
  });

  it('syncs several players at once', async () => {
    const seeds = ['ruler', 'peyz', 'gumayusi'];
    for (const seed of seeds) {
      await prisma.riotAccount.create({
        data: {
          puuid: puuid(seed),
          gameName: seed,
          tagLine: 'KR1',
          riotIdKey: `${seed}#kr1`,
          platform: 'kr',
        },
      });
    }
    // Each sync holds its slot for 500 ms on summoner-v4; one at a time would take at least 1.5 s.
    for (const seed of seeds) {
      riot('asia')
        .get(`/riot/account/v1/accounts/by-puuid/${puuid(seed)}`)
        .reply(200, { puuid: puuid(seed), gameName: seed, tagLine: 'KR1' });
      riot('kr')
        .get(`/lol/summoner/v4/summoners/by-puuid/${puuid(seed)}`)
        .delay(500)
        .reply(200, { puuid: puuid(seed), profileIconId: 1, revisionDate: 1, summonerLevel: 30 });
      riot('kr')
        .get(`/lol/league/v4/entries/by-puuid/${puuid(seed)}`)
        .reply(200, []);
      riot('kr')
        .get(`/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid(seed)}/top`)
        .query({ count: '10' })
        .reply(200, []);
    }

    const startedAt = performance.now();
    await Promise.all(seeds.map((seed) => refresh(seed)));
    for (const seed of seeds) {
      await expect.poll(() => syncStatus(seed), { ...SYNC_POLL, interval: 50 }).toBe('fresh');
    }

    expect(performance.now() - startedAt).toBeLessThan(1400);
  });

  it('documents players for the generated client', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs-json' })).json();
    const searchOperation = doc.paths['/players/search'].get;
    const jsonSchema = (operation: { responses: Record<string, unknown> }, status: string) =>
      (operation.responses[status] as { content: { 'application/json': { schema: unknown } } })
        .content['application/json'].schema;

    expect(jsonSchema(searchOperation, '200')).toEqual({ $ref: '#/components/schemas/Player' });
    expect(jsonSchema(searchOperation, '202')).toEqual({
      $ref: '#/components/schemas/PlayerSearchPending',
    });
    expect(searchOperation.parameters.map((p: { name: string }) => p.name).sort()).toEqual([
      'gameName',
      'platform',
      'tagLine',
    ]);
    // Swagger UI and generated clients evaluate `pattern` without the `u` flag.
    expect(JSON.stringify(searchOperation.parameters)).not.toContain('\\p{');
    expect(jsonSchema(doc.paths['/players/{puuid}'].get, '200')).toEqual({
      $ref: '#/components/schemas/PlayerProfile',
    });
    expect(jsonSchema(doc.paths['/players/{puuid}/rank-history'].get, '200')).toEqual({
      $ref: '#/components/schemas/RankHistory',
    });
    expect(jsonSchema(doc.paths['/players/{puuid}/refresh'].post, '200')).toEqual({
      $ref: '#/components/schemas/PlayerProfile',
    });
  });

  // Last: the 429 pauses account-v1 on asia for the rest of the file.
  it('answers 202 with Retry-After while Riot rate limits the lookup', async () => {
    riot('asia')
      .get(byRiotId('Keria', 'KR1'))
      .reply(429, {}, { 'Retry-After': '30', 'X-Rate-Limit-Type': 'method' });

    const res = await search('kr', 'Keria', 'KR1');

    expect(res.statusCode).toBe(202);
    expect(res.headers['retry-after']).toBe('3');
    expect(res.json()).toEqual({ status: 'pending' });
  }, 15_000);
});
