import { z } from 'zod';

export const PLATFORMS = [
  'br1',
  'eun1',
  'euw1',
  'jp1',
  'kr',
  'la1',
  'la2',
  'me1',
  'na1',
  'oc1',
  'ru',
  'sg2',
  'tr1',
  'tw2',
  'vn2',
] as const;

export const platformSchema = z.enum(PLATFORMS);

export type Platform = z.infer<typeof platformSchema>;

export const REGIONS = ['americas', 'asia', 'europe', 'sea'] as const;

export type Region = (typeof REGIONS)[number];

const ROUTING_VALUES: ReadonlySet<string> = new Set([...PLATFORMS, ...REGIONS]);

export function isRoutingValue(value: string): value is Platform | Region {
  return ROUTING_VALUES.has(value);
}

const MATCH_REGIONS: Record<Platform, Region> = {
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  na1: 'americas',
  jp1: 'asia',
  kr: 'asia',
  eun1: 'europe',
  euw1: 'europe',
  me1: 'europe',
  ru: 'europe',
  tr1: 'europe',
  oc1: 'sea',
  sg2: 'sea',
  tw2: 'sea',
  vn2: 'sea',
};

export function matchRegionOf(platform: Platform): Region {
  return MATCH_REGIONS[platform];
}

/** account-v1 has no `sea` cluster; every cluster returns the same accounts, so SEA uses the nearest one. */
export function accountRegionOf(platform: Platform): Exclude<Region, 'sea'> {
  const region = MATCH_REGIONS[platform];
  return region === 'sea' ? 'asia' : region;
}
