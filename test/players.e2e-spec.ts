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
import { riotIdKey } from '../src/riot/riot-id.js';

// Names are unique to this file: other e2e files share the database and store their own accounts.
const puuid = (seed: string) => seed.padEnd(78, 'x');
const byRiotId = (gameName: string, tagLine: string) =>
  `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
const riot = (region: string) => nock(`https://${region}.api.riotgames.com`);

function summoner(platform: string, seed: string, profileIconId = 29, summonerLevel = 100) {
  return riot(platform)
    .get(`/lol/summoner/v4/summoners/by-puuid/${puuid(seed)}`)
    .reply(200, { puuid: puuid(seed), profileIconId, revisionDate: 1, summonerLevel });
}

describe('player search (e2e)', () => {
  let app: NestFastifyApplication;
  let worker: INestApplicationContext;
  let prisma: PrismaService;

  const search = (platform: string, gameName: string, tagLine: string) =>
    app.inject({ method: 'GET', url: '/players/search', query: { platform, gameName, tagLine } });

  beforeAll(async () => {
    nock.disableNetConnect();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
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
  });

  afterEach(() => {
    expect(nock.pendingMocks()).toEqual([]);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('resolves an unknown Riot ID through the worker and stores the account', async () => {
    riot('europe')
      .get(byRiotId('zeus', 'kr1'))
      .reply(200, { puuid: puuid('zeus'), gameName: 'Zeus', tagLine: 'KR1' });
    summoner('euw1', 'zeus', 4568, 512);

    const res = await search('euw1', 'zeus', 'kr1');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      puuid: puuid('zeus'),
      gameName: 'Zeus',
      tagLine: 'KR1',
      platform: 'euw1',
      profileIconId: 4568,
      summonerLevel: 512,
      lastSyncedAt: null,
    });
    expect(await prisma.riotAccount.findUnique({ where: { puuid: puuid('zeus') } })).toMatchObject({
      riotIdKey: 'zeus#kr1',
      platform: 'euw1',
    });
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
    expect(await prisma.riotAccount.findUnique({ where: { puuid: puuid('zeus') } })).toMatchObject({
      platform: 'euw1',
    });
  });

  it('shares one Riot lookup between concurrent searches', async () => {
    riot('americas')
      .get(byRiotId('Doublelift', 'NA1'))
      .delay(300)
      .reply(200, { puuid: puuid('doublelift'), gameName: 'Doublelift', tagLine: 'NA1' });
    summoner('na1', 'doublelift');

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
    summoner('euw1', 'new-chovy');
    riot('asia')
      .get(`/riot/account/v1/accounts/by-puuid/${puuid('old-chovy')}`)
      .reply(200, { puuid: puuid('old-chovy'), gameName: 'Renamed', tagLine: 'KR2' });

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

  it('documents both outcomes for the generated client', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs-json' })).json();
    const operation = doc.paths['/players/search'].get;

    expect(operation.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/Player',
    });
    expect(operation.responses['202'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/PlayerSearchPending',
    });
    expect(operation.parameters.map((p: { name: string }) => p.name).sort()).toEqual([
      'gameName',
      'platform',
      'tagLine',
    ]);
    // Swagger UI and generated clients evaluate `pattern` without the `u` flag.
    expect(JSON.stringify(operation.parameters)).not.toContain('\\p{');
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
