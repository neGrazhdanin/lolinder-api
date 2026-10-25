import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { z } from 'zod';
import type { Env } from '../config/env.js';
import { RiotApiError, RiotSchemaError } from './riot.errors.js';
import {
  type ActiveGameDto,
  accountSchema,
  activeGameSchema,
  type ChampionMasteryDto,
  championMasteriesSchema,
  type LeagueEntryDto,
  leagueEntriesSchema,
  type MatchDto,
  type MatchTimelineDto,
  matchIdsSchema,
  matchSchema,
  matchTimelineSchema,
  type RiotAccountDto,
  type SummonerDto,
  summonerSchema,
} from './riot.schemas.js';
import { RiotRateLimiter } from './riot-rate-limiter.js';
import { accountRegionOf, isRoutingValue, matchRegionOf, type Platform } from './routing.js';

const REQUEST_TIMEOUT_MS = 10_000;

export interface MatchIdsQuery {
  start?: number;
  count?: number;
  queue?: number;
  type?: 'ranked' | 'normal' | 'tourney' | 'tutorial';
  startTime?: Date;
  endTime?: Date;
}

type Query = Record<string, string | number | undefined>;

/** Thin typed wrapper over the Riot API. Call it only from worker processors. */
@Injectable()
export class RiotClient {
  private readonly logger = new Logger(RiotClient.name);
  // ES private field: TypeScript `private` would still show the key in util.inspect output.
  readonly #apiKey: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly limiter: RiotRateLimiter,
  ) {
    const apiKey = config.get('RIOT_API_KEY', { infer: true });
    if (!apiKey) {
      throw new Error('RIOT_API_KEY is not set');
    }
    this.#apiKey = apiKey;
  }

  async getAccountByRiotId(
    platform: Platform,
    gameName: string,
    tagLine: string,
  ): Promise<RiotAccountDto | null> {
    return this.request(
      accountRegionOf(platform),
      'account-v1.getByRiotId',
      `/riot/account/v1/accounts/by-riot-id/${segment(gameName)}/${segment(tagLine)}`,
      accountSchema,
    );
  }

  async getAccountByPuuid(platform: Platform, puuid: string): Promise<RiotAccountDto | null> {
    return this.request(
      accountRegionOf(platform),
      'account-v1.getByPuuid',
      `/riot/account/v1/accounts/by-puuid/${segment(puuid)}`,
      accountSchema,
    );
  }

  async getSummonerByPuuid(platform: Platform, puuid: string): Promise<SummonerDto | null> {
    return this.request(
      platform,
      'summoner-v4.getByPuuid',
      `/lol/summoner/v4/summoners/by-puuid/${segment(puuid)}`,
      summonerSchema,
    );
  }

  async getLeagueEntries(platform: Platform, puuid: string): Promise<LeagueEntryDto[]> {
    const entries = await this.request(
      platform,
      'league-v4.getEntriesByPuuid',
      `/lol/league/v4/entries/by-puuid/${segment(puuid)}`,
      leagueEntriesSchema,
    );
    return entries ?? [];
  }

  /** Sorted by points, highest first. Without `count` returns every champion played. */
  async getChampionMasteries(
    platform: Platform,
    puuid: string,
    count?: number,
  ): Promise<ChampionMasteryDto[]> {
    const path = `/lol/champion-mastery/v4/champion-masteries/by-puuid/${segment(puuid)}`;
    const masteries =
      count === undefined
        ? await this.request(
            platform,
            'champion-mastery-v4.getAllByPuuid',
            path,
            championMasteriesSchema,
          )
        : await this.request(
            platform,
            'champion-mastery-v4.getTopByPuuid',
            `${path}/top`,
            championMasteriesSchema,
            { count },
          );
    return masteries ?? [];
  }

  /** Newest first. */
  async getMatchIds(
    platform: Platform,
    puuid: string,
    query: MatchIdsQuery = {},
  ): Promise<string[]> {
    const ids = await this.request(
      matchRegionOf(platform),
      'match-v5.getIdsByPuuid',
      `/lol/match/v5/matches/by-puuid/${segment(puuid)}/ids`,
      matchIdsSchema,
      {
        start: query.start,
        count: query.count,
        queue: query.queue,
        type: query.type,
        startTime: query.startTime && epochSeconds(query.startTime),
        endTime: query.endTime && epochSeconds(query.endTime),
      },
    );
    return ids ?? [];
  }

  async getMatch(platform: Platform, matchId: string): Promise<MatchDto | null> {
    return this.request(
      matchRegionOf(platform),
      'match-v5.getMatch',
      `/lol/match/v5/matches/${segment(matchId)}`,
      matchSchema,
    );
  }

  async getMatchTimeline(platform: Platform, matchId: string): Promise<MatchTimelineDto | null> {
    return this.request(
      matchRegionOf(platform),
      'match-v5.getTimeline',
      `/lol/match/v5/matches/${segment(matchId)}/timeline`,
      matchTimelineSchema,
    );
  }

  /** `null` when the player is not in a game or it is still in the loading screen. */
  async getActiveGame(platform: Platform, puuid: string): Promise<ActiveGameDto | null> {
    return this.request(
      platform,
      'spectator-v5.getActiveGame',
      `/lol/spectator/v5/active-games/by-summoner/${segment(puuid)}`,
      activeGameSchema,
    );
  }

  private async request<S extends z.ZodType>(
    host: string,
    endpoint: string,
    path: string,
    schema: S,
    query: Query = {},
  ): Promise<z.output<S> | null> {
    // Job payloads are untyped JSON, and a forged host would receive the API key.
    if (!isRoutingValue(host)) {
      throw new Error(`Unknown Riot routing value: ${host}`);
    }
    const url = new URL(path, `https://${host}.api.riotgames.com`);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(name, String(value));
      }
    }

    await this.limiter.acquire(host, endpoint);
    const response = await fetch(url, {
      headers: { 'X-Riot-Token': this.#apiKey },
      // fetch forwards custom headers like X-Riot-Token to a redirect target on another origin.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: unknown = response.ok ? await response.json() : await response.body?.cancel();
    await this.limiter.recordLimits(host, endpoint, response.headers);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = this.toError(endpoint, response);
      if (error.status === 429) {
        const scope =
          response.headers.get('x-rate-limit-type') === 'application' ? 'application' : 'method';
        await this.limiter.pause(host, endpoint, scope, error.retryAfterSeconds);
      }
      throw error;
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new RiotSchemaError(endpoint, parsed.error);
    }
    return parsed.data;
  }

  private toError(endpoint: string, response: Response): RiotApiError {
    if (response.status === 401 || response.status === 403) {
      this.logger.error(
        `Riot rejected the API key (${response.status}). Development keys expire after 24 hours: ` +
          'regenerate it at developer.riotgames.com and update RIOT_API_KEY.',
      );
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    return new RiotApiError(
      endpoint,
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }
}

// encodeURIComponent leaves `.` and `..` as is, and URL resolution would turn them into another path.
function segment(value: string): string {
  if (value === '' || value === '.' || value === '..') {
    throw new Error(`Invalid Riot path segment: "${value}"`);
  }
  return encodeURIComponent(value);
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
