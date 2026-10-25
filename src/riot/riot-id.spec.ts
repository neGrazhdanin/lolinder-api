import { describe, expect, it } from 'vitest';
import { riotIdKey } from './riot-id.js';

describe('riotIdKey', () => {
  it('matches Riot IDs regardless of case', () => {
    expect(riotIdKey('Hide on bush', 'KR1')).toBe(riotIdKey('hide ON BUSH', 'kr1'));
    expect(riotIdKey('Ägir', 'EUW')).toBe('ägir#euw');
  });
});
