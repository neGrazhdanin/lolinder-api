import { z } from 'zod';

export const STATIC_LOCALES = ['en', 'ru'] as const;

export const staticLocaleSchema = z.enum(STATIC_LOCALES).meta({ id: 'StaticLocale' });

export type StaticLocale = z.infer<typeof staticLocaleSchema>;

// Data Dragon versions look like `16.21.1`; checked before they reach a CDN URL or a query.
export const dataDragonVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const championSchema = z
  .object({
    id: z.number().int(),
    key: z.string(),
    name: z.string(),
    title: z.string(),
    image: z.string(),
  })
  .meta({ id: 'Champion' });

export const itemSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    plaintext: z.string(),
    gold: z.number().int(),
    image: z.string(),
    tags: z.array(z.string()),
    from: z.array(z.number().int()),
    into: z.array(z.number().int()),
  })
  .meta({ id: 'Item' });

export const runeSchema = z
  .object({
    id: z.number().int(),
    key: z.string(),
    name: z.string(),
    icon: z.string(),
  })
  .meta({ id: 'Rune' });

export const runeTreeSchema = z
  .object({
    id: z.number().int(),
    key: z.string(),
    name: z.string(),
    icon: z.string(),
    slots: z.array(z.array(runeSchema)),
  })
  .meta({ id: 'RuneTree' });

export const summonerSpellSchema = z
  .object({
    id: z.number().int(),
    key: z.string(),
    name: z.string(),
    image: z.string(),
  })
  .meta({ id: 'SummonerSpell' });

export const staticDataSetsSchema = z.object({
  champions: z.array(championSchema),
  items: z.array(itemSchema),
  runeTrees: z.array(runeTreeSchema),
  summonerSpells: z.array(summonerSpellSchema),
});

export type StaticDataSets = z.infer<typeof staticDataSetsSchema>;

export const staticDataBundleSchema = staticDataSetsSchema
  .extend({ version: z.string(), locale: staticLocaleSchema })
  .meta({ id: 'StaticDataBundle' });

export type StaticDataBundle = z.infer<typeof staticDataBundleSchema>;

export const staticDataVersionSchema = z
  .object({ version: z.string() })
  .meta({ id: 'StaticDataVersion' });

export type StaticDataVersion = z.infer<typeof staticDataVersionSchema>;
