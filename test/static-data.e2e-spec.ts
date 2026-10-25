import type { INestApplicationContext } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import nock from 'nock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { createFastifyAdapter } from '../src/bootstrap/fastify-adapter.js';
import { CoreModule } from '../src/core/core.module.js';
import { InfraModule } from '../src/infra/infra.module.js';
import { DataDragonClient } from '../src/static-data/data-dragon.client.js';
import { StaticDataService } from '../src/static-data/static-data.service.js';
import { StaticDataSyncProcessor } from '../src/static-data/static-data.sync.js';
import { StaticDataWorkerModule } from '../src/static-data/static-data-worker.module.js';
import { LATEST_VERSION, mockDataDragon } from './fixtures/data-dragon.js';

describe('static data (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    nock.disableNetConnect();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('answers SERVICE_UNAVAILABLE until the first patch is imported', async () => {
    const res = await app.inject({ method: 'GET', url: '/static-data/latest' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('imports the latest patch through the worker scheduler', async () => {
    const dataDragon = mockDataDragon();
    const workerRef = await Test.createTestingModule({
      imports: [CoreModule, InfraModule, StaticDataWorkerModule],
    }).compile();
    const worker: INestApplicationContext = await workerRef.init();

    try {
      await expect
        .poll(
          async () => (await app.inject({ method: 'GET', url: '/static-data/latest' })).json(),
          {
            timeout: 10_000,
          },
        )
        .toEqual({ version: LATEST_VERSION });
      expect(dataDragon.isDone()).toBe(true);
    } finally {
      await worker.close();
    }
  });

  it('serves the latest version with a short cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/static-data/latest' });
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });

  it('serves a localized bundle that is cached forever', async () => {
    const res = await app.inject({ method: 'GET', url: `/static-data/${LATEST_VERSION}/ru` });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const bundle = res.json();
    expect(bundle).toMatchObject({ version: LATEST_VERSION, locale: 'ru' });
    expect(bundle.champions).toEqual([
      { id: 266, key: 'Aatrox', name: 'Атрокс', title: 'the Darkin Blade', image: 'Aatrox.png' },
    ]);
    expect(bundle.items.map((item: { id: number }) => item.id)).toEqual([1001, 2003]);
    expect(bundle.runeTrees[0].slots[0][0]).toMatchObject({
      id: 8112,
      name: 'Казнь электричеством',
    });
    expect(bundle.summonerSpells).toEqual([
      { id: 4, key: 'SummonerFlash', name: 'Скачок', image: 'SummonerFlash.png' },
    ]);

    const en = await app.inject({ method: 'GET', url: `/static-data/${LATEST_VERSION}/en` });
    expect(en.json().champions[0].name).toBe('Aatrox');
  });

  it.each([
    ['an unknown version', '/static-data/1.0.1/en', 404, 'NOT_FOUND'],
    ['a malformed version', '/static-data/latest.json/en', 400, 'VALIDATION_FAILED'],
    ['an unsupported locale', `/static-data/${LATEST_VERSION}/de`, 400, 'VALIDATION_FAILED'],
  ])('rejects %s', async (_, url, status, code) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ code });
  });

  it('skips a patch that is already imported', async () => {
    const versions = nock('https://ddragon.leagueoflegends.com')
      .get('/api/versions.json')
      .reply(200, [LATEST_VERSION]);
    const processor = new StaticDataSyncProcessor(
      new DataDragonClient(),
      app.get(StaticDataService),
    );

    expect(await processor.process()).toEqual({ version: LATEST_VERSION, imported: false });
    expect(versions.isDone()).toBe(true);
  });

  it('documents the bundle schema for the generated client', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs-json' })).json();
    const bundle = doc.paths['/static-data/{version}/{locale}'].get;

    expect(bundle.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/StaticDataBundle',
    });
    expect(doc.components.schemas.StaticLocale.enum).toEqual(['en', 'ru']);
  });
});
