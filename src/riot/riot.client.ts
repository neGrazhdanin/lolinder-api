import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import {
  type ActiveGameDto,
  accountSchema,
  activeGameSchema,
  type ChampionMasteryDto,
  championMasterySchema,
  type LeagueEntryDto,
  leagueEntrySchema,
  type MatchDto,
  type MatchTimelineDto,
  matchIdsSchema,
  matchSchema,
  matchTimelineSchema,
  type RiotAccountDto,
  type SummonerDto,
  summonerSchema,
} from './riot.schemas.js';
import { RiotApiError } from './riot-api.error.js';
import { accountRegionOf, matchRegionOf, type Platform } from './routing.js';

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
  private readonly apiKey: string;

  constructor(config: ConfigService<Env, true>) {
    const apiKey = config.get('RIOT_API_KEY', { infer: true });
    if (!apiKey) {
      throw new Error('RIOT_API_KEY is not set');
    }
    this.apiKey = apiKey;
  }

  getAccountByRiotId(
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

  getAccountByPuuid(platform: Platform, puuid: string): Promise<RiotAccountDto | null> {
    return this.request(
      accountRegionOf(platform),
      'account-v1.getByPuuid',
      `/riot/account/v1/accounts/by-puuid/${segment(puuid)}`,
      accountSchema,
    );
  }

  getSummonerByPuuid(platform: Platform, puuid: string): Promise<SummonerDto | null> {
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
      z.array(leagueEntrySchema),
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
            z.array(championMasterySchema),
          )
        : await this.request(
            platform,
            'champion-mastery-v4.getTopByPuuid',
            `${path}/top`,
            z.array(championMasterySchema),
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

  getMatch(platform: Platform, matchId: string): Promise<MatchDto | null> {
    return this.request(
      matchRegionOf(platform),
      'match-v5.getMatch',
      `/lol/match/v5/matches/${segment(matchId)}`,
      matchSchema,
    );
  }

  getMatchTimeline(platform: Platform, matchId: string): Promise<MatchTimelineDto | null> {
    return this.request(
      matchRegionOf(platform),
      'match-v5.getTimeline',
      `/lol/match/v5/matches/${segment(matchId)}/timeline`,
      matchTimelineSchema,
    );
  }

  /** `null` when the player is not in a game or it is still in the loading screen. */
  getActiveGame(platform: Platform, puuid: string): Promise<ActiveGameDto | null> {
    return this.request(
      platform,
      'spectator-v5.getActiveGame',
      `/lol/spectator/v5/active-games/by-summoner/${segment(puuid)}`,
      activeGameSchema,
    );
  }

  /** Resolves to `null` on 404; any other non-2xx status throws `RiotApiError`. */
  private async request<S extends z.ZodType>(
    host: string,
    endpoint: string,
    path: string,
    schema: S,
    query: Query = {},
  ): Promise<z.output<S> | null> {
    const url = new URL(path, `https://${host}.api.riotgames.com`);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(name, String(value));
      }
    }

    const response = await fetch(url, {
      headers: { 'X-Riot-Token': this.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) {
        return null;
      }
      throw this.toError(endpoint, response);
    }

    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(`Riot ${endpoint} response does not match the schema`, {
        cause: parsed.error,
      });
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

function segment(value: string): string {
  return encodeURIComponent(value);
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
