export const MATCHES_QUEUE = 'matches';

export const MATCHES_CONCURRENCY = 10;

export const MatchJob = {
  SYNC_NEWEST: 'sync-newest-matches',
  LOAD_OLDER: 'load-older-matches',
} as const;

export interface MatchHistoryJobData {
  puuid: string;
}

export function newestMatchesJobId(puuid: string): string {
  return `matches-newest-${puuid}`;
}

export function olderMatchesJobId(puuid: string): string {
  return `matches-older-${puuid}`;
}

export const MATCH_IDS_BATCH = 20;
export const MATCH_FETCH_PARALLEL = 5;
// Riot does not document which game time `endTime` filters on; starting the next batch this much later
// than the oldest known match also covers filtering by end time, and known matches cost no request.
export const OLDER_BATCH_OVERLAP_MS = 2 * 60 * 60 * 1000;
// A run of batches that only meets known matches stops here instead of walking the whole history.
export const MAX_BATCHES_PER_JOB = 5;
export const FAILED_HISTORY_BACKOFF_MS = 5 * 60 * 1000;

export const MATCH_PAGE_SIZE = 20;
export const MAX_MATCH_PAGE_SIZE = 50;

export const MATCH_QUEUE_FILTERS = ['solo', 'flex', 'normal', 'aram', 'arena'] as const;

export type MatchQueueFilter = (typeof MATCH_QUEUE_FILTERS)[number];

// Riot queue IDs from https://static.developer.riotgames.com/docs/lol/queues.json
export const QUEUE_IDS: Record<MatchQueueFilter, number[]> = {
  solo: [420],
  flex: [440],
  normal: [400, 430, 480, 490],
  aram: [450],
  arena: [1700, 1710],
};
