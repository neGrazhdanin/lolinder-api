import nock from 'nock';

export const DDRAGON_HOST = 'https://ddragon.leagueoflegends.com';
export const LATEST_VERSION = '16.21.1';

const names = {
  en_US: {
    aatrox: 'Aatrox',
    boots: 'Boots',
    flash: 'Flash',
    domination: 'Domination',
    electrocute: 'Electrocute',
  },
  ru_RU: {
    aatrox: 'Атрокс',
    boots: 'Ботинки',
    flash: 'Скачок',
    domination: 'Доминирование',
    electrocute: 'Казнь электричеством',
  },
} as const;

export type DataDragonLocale = keyof typeof names;

export function dataDragonFiles(locale: DataDragonLocale) {
  const n = names[locale];
  return {
    champion: {
      type: 'champion',
      data: {
        Aatrox: {
          id: 'Aatrox',
          key: '266',
          name: n.aatrox,
          title: 'the Darkin Blade',
          blurb: 'ignored',
          image: { full: 'Aatrox.png', sprite: 'champion0.png' },
        },
      },
    },
    item: {
      type: 'item',
      data: {
        '1001': {
          name: n.boots,
          description: '<mainText>ignored</mainText>',
          plaintext: 'Slightly increases Move Speed',
          into: ['3006', '3009'],
          image: { full: '1001.png' },
          gold: { base: 300, total: 300, sell: 210 },
          tags: ['Boots'],
        },
        '2003': { name: 'Health Potion', image: { full: '2003.png' }, gold: { total: 50 } },
      },
    },
    runesReforged: [
      {
        id: 8100,
        key: 'Domination',
        icon: 'perk-images/Styles/7200_Domination.png',
        name: n.domination,
        slots: [
          {
            runes: [
              {
                id: 8112,
                key: 'Electrocute',
                icon: 'perk-images/Styles/Domination/Electrocute/Electrocute.png',
                name: n.electrocute,
                shortDesc: 'ignored',
              },
            ],
          },
        ],
      },
    ],
    summoner: {
      type: 'summoner',
      data: {
        SummonerFlash: {
          id: 'SummonerFlash',
          key: '4',
          name: n.flash,
          image: { full: 'SummonerFlash.png' },
        },
      },
    },
  };
}

/** Intercepts versions.json and every data file of `version` for both locales. */
export function mockDataDragon(version = LATEST_VERSION) {
  const scope = nock(DDRAGON_HOST).get('/api/versions.json').reply(200, [version, '16.20.1']);
  for (const locale of ['en_US', 'ru_RU'] as const) {
    for (const [file, body] of Object.entries(dataDragonFiles(locale))) {
      scope.get(`/cdn/${version}/data/${locale}/${file}.json`).reply(200, body);
    }
  }
  return scope;
}
