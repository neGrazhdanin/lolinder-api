import nock from 'nock';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DDRAGON_HOST, LATEST_VERSION, mockDataDragon } from '../../test/fixtures/data-dragon.js';
import { DataDragonClient } from './data-dragon.client.js';

describe('DataDragonClient', () => {
  const client = new DataDragonClient();

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  it('takes the first entry of versions.json as the latest version', async () => {
    mockDataDragon();
    expect(await client.latestVersion()).toBe(LATEST_VERSION);
  });

  it('rejects a version that is not shaped like a Data Dragon version', async () => {
    nock(DDRAGON_HOST).get('/api/versions.json').reply(200, ['../evil']);
    await expect(client.latestVersion()).rejects.toThrow();
    await expect(client.fetchSets('../evil', 'en')).rejects.toThrow();
  });

  it('keeps only rendered fields, keyed by numeric IDs, in the requested locale', async () => {
    mockDataDragon();

    const sets = await client.fetchSets(LATEST_VERSION, 'ru');

    expect(sets.champions).toEqual([
      { id: 266, key: 'Aatrox', name: 'Атрокс', title: 'the Darkin Blade', image: 'Aatrox.png' },
    ]);
    expect(sets.items).toEqual([
      {
        id: 1001,
        name: 'Ботинки',
        plaintext: 'Slightly increases Move Speed',
        gold: 300,
        image: '1001.png',
        tags: ['Boots'],
        from: [],
        into: [3006, 3009],
      },
      {
        id: 2003,
        name: 'Health Potion',
        plaintext: '',
        gold: 50,
        image: '2003.png',
        tags: [],
        from: [],
        into: [],
      },
    ]);
    expect(sets.runeTrees).toEqual([
      {
        id: 8100,
        key: 'Domination',
        name: 'Доминирование',
        icon: 'perk-images/Styles/7200_Domination.png',
        slots: [
          [
            {
              id: 8112,
              key: 'Electrocute',
              name: 'Казнь электричеством',
              icon: 'perk-images/Styles/Domination/Electrocute/Electrocute.png',
            },
          ],
        ],
      },
    ]);
    expect(sets.summonerSpells).toEqual([
      { id: 4, key: 'SummonerFlash', name: 'Скачок', image: 'SummonerFlash.png' },
    ]);
  });

  it('fails on a non-2xx response', async () => {
    nock(DDRAGON_HOST).get('/api/versions.json').reply(503);
    await expect(client.latestVersion()).rejects.toThrow(/503/);
  });
});
