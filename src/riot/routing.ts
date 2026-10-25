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

export type Region = 'americas' | 'asia' | 'europe' | 'sea';

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

/** Region that serves match-v5 for the platform. */
export function matchRegionOf(platform: Platform): Region {
  return MATCH_REGIONS[platform];
}

/** account-v1 has no `sea` cluster; every cluster returns the same accounts, so SEA uses the nearest one. */
export function accountRegionOf(platform: Platform): Exclude<Region, 'sea'> {
  const region = MATCH_REGIONS[platform];
  return region === 'sea' ? 'asia' : region;
}
