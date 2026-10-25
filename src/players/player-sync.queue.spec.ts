import type { Job, JobState, Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerSyncQueue } from './player-sync.queue.js';
import { FAILED_SYNC_BACKOFF_MS, SyncPriority, syncJobId } from './players.constants.js';

const puuid = 'p'.repeat(78);

function setup(existing?: { state: JobState; priority?: number; finishedOn?: number }) {
  const job = existing && {
    opts: { priority: existing.priority },
    finishedOn: existing.finishedOn,
    getState: vi.fn(async () => existing.state),
    changePriority: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const queue = {
    getJob: vi.fn(async () => job as unknown as Job | undefined),
    add: vi.fn(async () => ({}) as Job),
  };
  return { job, queue, syncQueue: new PlayerSyncQueue(queue as unknown as Queue) };
}

describe('PlayerSyncQueue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds a sync job keyed by the player', async () => {
    const { queue, syncQueue } = setup();

    expect(await syncQueue.enqueue(puuid, SyncPriority.BACKGROUND)).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      'sync-player',
      { puuid },
      expect.objectContaining({ jobId: syncJobId(puuid), priority: SyncPriority.BACKGROUND }),
    );
  });

  it('joins a queued sync and raises it to user priority', async () => {
    const { job, queue, syncQueue } = setup({
      state: 'prioritized',
      priority: SyncPriority.BACKGROUND,
    });

    expect(await syncQueue.enqueue(puuid, SyncPriority.USER)).toBe(true);
    expect(job?.changePriority).toHaveBeenCalledWith({ priority: SyncPriority.USER });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('never lowers the priority of a queued user sync', async () => {
    const { job, syncQueue } = setup({ state: 'prioritized', priority: SyncPriority.USER });

    await syncQueue.enqueue(puuid, SyncPriority.BACKGROUND);
    expect(job?.changePriority).not.toHaveBeenCalled();
  });

  it.each(['active', 'delayed', 'waiting'] as const)('joins a %s sync as is', async (state) => {
    const { job, queue, syncQueue } = setup({ state, priority: SyncPriority.BACKGROUND });

    expect(await syncQueue.enqueue(puuid, SyncPriority.USER)).toBe(true);
    expect(job?.changePriority).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('holds background syncs back right after a failure, but not a user refresh', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const failed = { state: 'failed' as const, finishedOn: 1_000_000 - 1000 };

    const background = setup(failed);
    expect(await background.syncQueue.enqueue(puuid, SyncPriority.BACKGROUND)).toBe(false);
    expect(background.queue.add).not.toHaveBeenCalled();

    const user = setup(failed);
    expect(await user.syncQueue.enqueue(puuid, SyncPriority.USER)).toBe(true);
    expect(user.job?.remove).toHaveBeenCalled();
    expect(user.queue.add).toHaveBeenCalled();
  });

  it('replaces a failed job once the backoff has passed', async () => {
    vi.useFakeTimers({ now: 1_000_000 + FAILED_SYNC_BACKOFF_MS });
    const { job, queue, syncQueue } = setup({ state: 'failed', finishedOn: 1_000_000 });

    expect(await syncQueue.enqueue(puuid, SyncPriority.BACKGROUND)).toBe(true);
    expect(job?.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });

  it.each([
    ['active', true],
    ['prioritized', true],
    ['failed', false],
    ['completed', false],
  ] as const)('reports a %s job as syncing: %s', async (state, syncing) => {
    expect(await setup({ state }).syncQueue.isSyncing(puuid)).toBe(syncing);
  });
});
