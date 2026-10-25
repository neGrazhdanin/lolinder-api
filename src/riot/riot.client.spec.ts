import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import nock from 'nock';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { RiotClient } from './riot.client.js';
import { RiotApiError, RiotSchemaError } from './riot.errors.js';
import type { RiotRateLimiter } from './riot-rate-limiter.js';

const API_KEY = 'RGAPI-test'; // secrets-scan:allow

function createLimiter() {
  return {
    acquire: vi.fn(async () => {}),
    recordLimits: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
  };
}

function createClient(apiKey = API_KEY, limiter = createLimiter()): RiotClient {
  return new RiotClient(
    { get: () => apiKey } as unknown as ConfigService<Env, true>,
    limiter as unknown as RiotRateLimiter,
  );
}

function riot(host: string) {
  return nock(`https://${host}.api.riotgames.com`, { reqheaders: { 'x-riot-token': API_KEY } });
}

const participant = {
  participantId: 1,
  puuid: 'puuid-1',
  teamId: 100,
  championId: 103,
  teamPosition: 'MIDDLE',
  win: true,
  kills: 7,
  deaths: 2,
  assists: 9,
  totalDamageDealtToChampions: 24_000,
  goldEarned: 12_500,
  totalMinionsKilled: 210,
  neutralMinionsKilled: 12,
  visionScore: 25,
  item0: 3089,
  item1: 3020,
  item2: 0,
  item3: 0,
  item4: 0,
  item5: 0,
  item6: 3340,
  summoner1Id: 4,
  summoner2Id: 14,
  perks: { styles: [] },
  pentaKills: 0,
};

const match = {
  metadata: { matchId: 'EUW1_7000000001', participants: ['puuid-1'], dataVersion: '2' },
  info: {
    platformId: 'EUW1',
    queueId: 420,
    gameVersion: '16.20.712.4512',
    gameStartTimestamp: 1_792_000_000_000,
    gameDuration: 1834,
    participants: [participant],
    teams: [
      { teamId: 100, win: true, objectives: {} },
      { teamId: 200, win: false, objectives: {} },
    ],
    gameMode: 'CLASSIC',
  },
};

describe('RiotClient', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  it('refuses to start without an API key', () => {
    expect(() => createClient('')).toThrow(/RIOT_API_KEY/);
  });

  it('calls the platform host with the key header and parses the response', async () => {
    const scope = riot('euw1')
      .get('/lol/summoner/v4/summoners/by-puuid/puuid-1')
      .reply(200, { puuid: 'puuid-1', profileIconId: 29, revisionDate: 1, summonerLevel: 412 });

    expect(await createClient().getSummonerByPuuid('euw1', 'puuid-1')).toEqual({
      puuid: 'puuid-1',
      profileIconId: 29,
      revisionDate: 1,
      summonerLevel: 412,
    });
    expect(scope.isDone()).toBe(true);
  });

  it('looks up a Riot ID on the nearest account cluster with encoded segments', async () => {
    const scope = riot('asia')
      .get('/riot/account/v1/accounts/by-riot-id/Hide%20on%20bush/%E9%9F%A9%E5%9B%BD')
      .reply(200, { puuid: 'puuid-1', gameName: 'Hide on bush', tagLine: '韩国' });

    const account = await createClient().getAccountByRiotId('sg2', 'Hide on bush', '韩国');
    expect(account).toEqual({ puuid: 'puuid-1', gameName: 'Hide on bush', tagLine: '韩国' });
    expect(scope.isDone()).toBe(true);
  });

  it('queries match ids on the regional host with epoch-second bounds', async () => {
    const scope = riot('sea')
      .get('/lol/match/v5/matches/by-puuid/puuid-1/ids')
      .query({ count: '20', queue: '420', startTime: '1792000000' })
      .reply(200, ['OC1_1', 'OC1_2']);

    const ids = await createClient().getMatchIds('oc1', 'puuid-1', {
      count: 20,
      queue: 420,
      startTime: new Date(1_792_000_000_500),
    });
    expect(ids).toEqual(['OC1_1', 'OC1_2']);
    expect(scope.isDone()).toBe(true);
  });

  it('keeps unknown match fields so the raw payload can be stored', async () => {
    riot('europe').get('/lol/match/v5/matches/EUW1_7000000001').reply(200, match);

    expect(await createClient().getMatch('euw1', 'EUW1_7000000001')).toEqual(match);
  });

  it('returns null for a 404 and an empty list for list endpoints', async () => {
    riot('kr').get('/lol/spectator/v5/active-games/by-summoner/puuid-1').reply(404);
    riot('kr').get('/lol/league/v4/entries/by-puuid/puuid-1').reply(404);

    const client = createClient();
    expect(await client.getActiveGame('kr', 'puuid-1')).toBeNull();
    expect(await client.getLeagueEntries('kr', 'puuid-1')).toEqual([]);
  });

  it('throws RiotApiError with Retry-After on 429 and keeps the key out of the error', async () => {
    riot('na1')
      .get('/lol/league/v4/entries/by-puuid/puuid-1')
      .reply(429, {}, { 'Retry-After': '7' });

    const error = await createClient()
      .getLeagueEntries('na1', 'puuid-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RiotApiError);
    expect(error).toMatchObject({
      endpoint: 'league-v4.getEntriesByPuuid',
      status: 429,
      retryAfterSeconds: 7,
    });
    expect(JSON.stringify(error) + String(error)).not.toContain(API_KEY);
  });

  it('sends the request only after the limiter lets it through', async () => {
    const limiter = createLimiter();
    const { promise: slot, resolve: openSlot } = Promise.withResolvers<void>();
    limiter.acquire.mockReturnValueOnce(slot);
    const scope = riot('europe').get('/lol/match/v5/matches/by-puuid/puuid-1/ids').reply(200, []);

    const ids = createClient(API_KEY, limiter).getMatchIds('euw1', 'puuid-1');
    await vi.waitFor(() => expect(limiter.acquire).toHaveBeenCalled());
    expect(scope.isDone()).toBe(false);

    openSlot();
    expect(await ids).toEqual([]);
    expect(limiter.acquire).toHaveBeenCalledWith('europe', 'match-v5.getIdsByPuuid');
  });

  it.each([200, 404, 429, 500])('records the limits Riot reports on a %i', async (status) => {
    const limiter = createLimiter();
    const headers = { 'X-App-Rate-Limit': '20:1,100:120', 'X-Method-Rate-Limit': '2000:60' };
    riot('europe').get('/lol/match/v5/matches/by-puuid/puuid-1/ids').reply(status, [], headers);

    await createClient(API_KEY, limiter)
      .getMatchIds('euw1', 'puuid-1')
      .catch(() => {});

    const [, , recorded] = limiter.recordLimits.mock.calls[0] as unknown as [
      string,
      string,
      Headers,
    ];
    expect(recorded.get('x-app-rate-limit')).toBe('20:1,100:120');
  });

  it.each([404, 500, 503])('does not pause on a %i', async (status) => {
    const limiter = createLimiter();
    riot('kr').get('/lol/league/v4/entries/by-puuid/puuid-1').reply(status);

    await createClient(API_KEY, limiter)
      .getLeagueEntries('kr', 'puuid-1')
      .catch(() => {});
    expect(limiter.pause).not.toHaveBeenCalled();
  });

  it.each([
    ['application', 'application'],
    ['method', 'method'],
    ['service', 'method'],
  ] as const)('pauses the %s scope on a 429 of type %s', async (type, scope) => {
    const limiter = createLimiter();
    riot('kr')
      .get('/lol/league/v4/entries/by-puuid/puuid-1')
      .reply(429, {}, { 'Retry-After': '3', 'X-Rate-Limit-Type': type });

    await expect(createClient(API_KEY, limiter).getLeagueEntries('kr', 'puuid-1')).rejects.toThrow(
      RiotApiError,
    );
    expect(limiter.pause).toHaveBeenCalledWith('kr', 'league-v4.getEntriesByPuuid', scope, 3);
  });

  it('logs a key hint when Riot rejects the key', async () => {
    const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    riot('euw1').get('/lol/summoner/v4/summoners/by-puuid/puuid-1').reply(403);

    await expect(createClient().getSummonerByPuuid('euw1', 'puuid-1')).rejects.toMatchObject({
      status: 403,
    });
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/RIOT_API_KEY/));
    expect(logError).not.toHaveBeenCalledWith(expect.stringContaining(API_KEY));
  });

  it('rejects a response that does not match the schema', async () => {
    riot('euw1')
      .get('/lol/summoner/v4/summoners/by-puuid/puuid-1')
      .reply(200, { puuid: 'puuid-1', summonerLevel: 'high' });

    await expect(createClient().getSummonerByPuuid('euw1', 'puuid-1')).rejects.toThrow(
      RiotSchemaError,
    );
  });

  it('refuses a routing value outside the known platforms and regions', async () => {
    const limiter = createLimiter();
    const forged = 'evil.example#' as Parameters<RiotClient['getSummonerByPuuid']>[0];

    await expect(
      createClient(API_KEY, limiter).getSummonerByPuuid(forged, 'puuid-1'),
    ).rejects.toThrow(/Unknown Riot routing value/);
    expect(limiter.acquire).not.toHaveBeenCalled();
  });

  it.each(['', '.', '..'])('refuses the path segment "%s"', async (matchId) => {
    await expect(createClient().getMatchTimeline('euw1', matchId)).rejects.toThrow(
      /Invalid Riot path segment/,
    );
  });

  it('does not follow redirects, so the key never reaches another host', async () => {
    riot('euw1')
      .get('/lol/summoner/v4/summoners/by-puuid/puuid-1')
      .reply(302, undefined, { Location: 'https://evil.example/collect' });
    const evil = nock('https://evil.example').get('/collect').reply(200, {});

    await expect(createClient().getSummonerByPuuid('euw1', 'puuid-1')).rejects.toThrow();
    expect(evil.isDone()).toBe(false);
  });

  it('keeps the key out of util.inspect output', async () => {
    const { inspect } = await import('node:util');
    expect(inspect(createClient(), { depth: 5 })).not.toContain(API_KEY);
  });
});
