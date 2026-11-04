import { describe, expect, it } from 'vitest';
import { type MatchTimelineDto, matchTimelineSchema } from '../riot/riot.schemas.js';
import { toTimelineRecord } from './timeline-record.js';

const frame = (minute: number, events: object[] = []) => ({
  timestamp: minute * 60_000 + (minute ? 17 : 0),
  participantFrames: {
    '2': {
      participantId: 2,
      totalGold: 500 + minute * 300,
      xp: minute * 400,
      minionsKilled: minute * 7,
      jungleMinionsKilled: 1,
    },
    '1': {
      participantId: 1,
      totalGold: 500 + minute * 350,
      xp: minute * 420,
      minionsKilled: minute * 8,
      jungleMinionsKilled: 0,
    },
  },
  events,
});

function dto(events: object[]): MatchTimelineDto {
  return matchTimelineSchema.parse({
    metadata: { matchId: 'EUW1_1' },
    info: { frameInterval: 60_000, frames: [frame(0, events), frame(1), frame(2)] },
  });
}

describe('toTimelineRecord', () => {
  it('keeps gold, CS and XP per frame for every participant', () => {
    const { frames } = toTimelineRecord(dto([]));

    expect(frames.times).toEqual([0, 60, 120]);
    expect(frames.participants).toEqual([
      { participantId: 1, gold: [500, 850, 1200], cs: [0, 8, 16], xp: [0, 420, 840] },
      { participantId: 2, gold: [500, 800, 1100], cs: [1, 8, 15], xp: [0, 400, 800] },
    ]);
  });

  it('drops purchases and sales that were undone', () => {
    const { events } = toTimelineRecord(
      dto([
        { type: 'ITEM_PURCHASED', timestamp: 2000, participantId: 1, itemId: 1055 },
        { type: 'ITEM_PURCHASED', timestamp: 2500, participantId: 1, itemId: 2003 },
        { type: 'ITEM_UNDO', timestamp: 3000, participantId: 1, beforeId: 2003, afterId: 0 },
        { type: 'ITEM_SOLD', timestamp: 4000, participantId: 1, itemId: 1055 },
        { type: 'ITEM_UNDO', timestamp: 4500, participantId: 1, beforeId: 0, afterId: 1055 },
        { type: 'ITEM_PURCHASED', timestamp: 5000, participantId: 2, itemId: 1054 },
      ]),
    );

    expect(events.items).toEqual([
      { participantId: 1, atSec: 2, itemId: 1055, kind: 'buy' },
      { participantId: 2, atSec: 5, itemId: 1054, kind: 'buy' },
    ]);
  });

  it('keeps skill points and skips evolutions', () => {
    const { events } = toTimelineRecord(
      dto([
        {
          type: 'SKILL_LEVEL_UP',
          timestamp: 90_000,
          participantId: 1,
          skillSlot: 1,
          levelUpType: 'NORMAL',
        },
        {
          type: 'SKILL_LEVEL_UP',
          timestamp: 95_000,
          participantId: 1,
          skillSlot: 4,
          levelUpType: 'EVOLVE',
        },
        { type: 'WARD_PLACED', timestamp: 96_000, creatorId: 1 },
      ]),
    );

    expect(events.skills).toEqual([{ participantId: 1, atSec: 90, slot: 1 }]);
  });
});
