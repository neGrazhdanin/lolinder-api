import { StaticDataKind } from '../generated/prisma/enums.js';
import type { StaticDataSets, StaticLocale } from './static-data.schemas.js';

export const STATIC_DATA_QUEUE = 'static-data';

export const DATA_DRAGON_LOCALES: Record<StaticLocale, string> = { en: 'en_US', ru: 'ru_RU' };

export const KIND_OF_SET: Record<keyof StaticDataSets, StaticDataKind> = {
  champions: StaticDataKind.CHAMPIONS,
  items: StaticDataKind.ITEMS,
  runeTrees: StaticDataKind.RUNES,
  summonerSpells: StaticDataKind.SUMMONER_SPELLS,
};
