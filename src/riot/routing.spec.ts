import { describe, expect, it } from 'vitest';
import { accountRegionOf, matchRegionOf, PLATFORMS } from './routing.js';

describe('routing', () => {
  it.each([
    ['euw1', 'europe'],
    ['ru', 'europe'],
    ['me1', 'europe'],
    ['na1', 'americas'],
    ['kr', 'asia'],
    ['oc1', 'sea'],
    ['vn2', 'sea'],
  ] as const)('serves %s matches from %s', (platform, region) => {
    expect(matchRegionOf(platform)).toBe(region);
  });

  it('never routes account-v1 to sea', () => {
    expect(PLATFORMS.map(accountRegionOf)).not.toContain('sea');
    expect(accountRegionOf('sg2')).toBe('asia');
    expect(accountRegionOf('euw1')).toBe('europe');
  });
});
