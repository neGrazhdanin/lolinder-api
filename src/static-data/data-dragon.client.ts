import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DATA_DRAGON_LOCALES } from './static-data.constants.js';
import {
  dataDragonVersionSchema,
  type StaticDataImport,
  type StaticLocale,
} from './static-data.schemas.js';

const BASE_URL = 'https://ddragon.leagueoflegends.com';
const REQUEST_TIMEOUT_MS = 30_000;

const versionsSchema = z.array(z.string()).nonempty();

const imageSchema = z.object({ full: z.string() });

const championsSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      title: z.string(),
      image: imageSchema,
    }),
  ),
});

const itemsSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      name: z.string(),
      plaintext: z.string().default(''),
      description: z.string().default(''),
      image: imageSchema,
      gold: z.object({ total: z.number().int() }),
      tags: z.array(z.string()).default([]),
      from: z.array(z.string()).default([]),
      into: z.array(z.string()).default([]),
    }),
  ),
});

const runeTreesSchema = z.array(
  z.object({
    id: z.number().int(),
    key: z.string(),
    name: z.string(),
    icon: z.string(),
    slots: z.array(
      z.object({
        runes: z.array(
          z.object({
            id: z.number().int(),
            key: z.string(),
            name: z.string(),
            icon: z.string(),
            longDesc: z.string().default(''),
          }),
        ),
      }),
    ),
  }),
);

const summonerSpellsSchema = z.object({
  data: z.record(
    z.string(),
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      image: imageSchema,
      description: z.string().default(''),
      cooldown: z.array(z.number()).default([]),
    }),
  ),
});

/** Data Dragon CDN: no API key and no Riot rate limits. */
@Injectable()
export class DataDragonClient {
  async latestVersion(): Promise<string> {
    const [latest] = await this.get('/api/versions.json', versionsSchema);
    return dataDragonVersionSchema.parse(latest);
  }

  /** Keeps only the fields the client renders, keyed by numeric Data Dragon IDs. */
  async fetchSets(version: string, locale: StaticLocale): Promise<StaticDataImport> {
    const base = `/cdn/${dataDragonVersionSchema.parse(version)}/data/${DATA_DRAGON_LOCALES[locale]}`;
    const [champions, items, runeTrees, summonerSpells] = await Promise.all([
      this.get(`${base}/champion.json`, championsSchema),
      this.get(`${base}/item.json`, itemsSchema),
      this.get(`${base}/runesReforged.json`, runeTreesSchema),
      this.get(`${base}/summoner.json`, summonerSpellsSchema),
    ]);

    const runes = runeTrees.flatMap((tree) => tree.slots.flatMap((slot) => slot.runes));
    const sets = {
      champions: Object.values(champions.data).map((champion) => ({
        id: Number(champion.key),
        key: champion.id,
        name: champion.name,
        title: champion.title,
        image: champion.image.full,
      })),
      items: Object.entries(items.data).map(([id, item]) => ({
        id: Number(id),
        name: item.name,
        plaintext: item.plaintext,
        gold: item.gold.total,
        image: item.image.full,
        tags: item.tags,
        from: item.from.map(Number),
        into: item.into.map(Number),
      })),
      runeTrees: runeTrees.map((tree) => ({
        id: tree.id,
        key: tree.key,
        name: tree.name,
        icon: tree.icon,
        slots: tree.slots.map((slot) =>
          slot.runes.map((rune) => ({
            id: rune.id,
            key: rune.key,
            name: rune.name,
            icon: rune.icon,
          })),
        ),
      })),
      summonerSpells: Object.values(summonerSpells.data).map((spell) => ({
        id: Number(spell.key),
        key: spell.id,
        name: spell.name,
        image: spell.image.full,
      })),
    };
    const descriptions = {
      items: Object.entries(items.data).map(([id, item]) => ({
        id: Number(id),
        description: item.description,
      })),
      runes: runes.map((rune) => ({ id: rune.id, description: rune.longDesc })),
      summonerSpells: Object.values(summonerSpells.data).map((spell) => ({
        id: Number(spell.key),
        description: spell.description,
        cooldownSec: spell.cooldown[0] ?? null,
      })),
    };
    return { sets, descriptions };
  }

  private async get<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
    const response = await fetch(new URL(path, BASE_URL), {
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Data Dragon ${path} responded with ${response.status}`);
    }
    return schema.parse(await response.json());
  }
}
