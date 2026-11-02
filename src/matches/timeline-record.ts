import type { MatchTimelineDto } from '../riot/riot.schemas.js';
import type { StoredTimelineEvents, StoredTimelineFrames } from './matches.schemas.js';

type ItemEvent = StoredTimelineEvents['items'][number];

export function toTimelineRecord(dto: MatchTimelineDto): {
  frames: StoredTimelineFrames;
  events: StoredTimelineEvents;
} {
  const { frames } = dto.info;
  const participantIds = Object.values(frames[0]?.participantFrames ?? {})
    .map((frame) => frame.participantId)
    .sort((a, b) => a - b);

  const items: ItemEvent[] = [];
  const skills: StoredTimelineEvents['skills'] = [];
  for (const event of frames.flatMap((frame) => frame.events)) {
    const { participantId } = event;
    if (!participantId) {
      continue;
    }
    const atSec = Math.round(event.timestamp / 1000);
    if ((event.type === 'ITEM_PURCHASED' || event.type === 'ITEM_SOLD') && event.itemId) {
      const kind = event.type === 'ITEM_PURCHASED' ? 'buy' : 'sell';
      items.push({ participantId, atSec, itemId: event.itemId, kind });
    } else if (event.type === 'ITEM_UNDO') {
      undo(items, participantId, event.beforeId ?? 0, event.afterId ?? 0);
    } else if (
      event.type === 'SKILL_LEVEL_UP' &&
      event.levelUpType === 'NORMAL' &&
      event.skillSlot
    ) {
      skills.push({ participantId, atSec, slot: event.skillSlot });
    }
  }

  return {
    frames: {
      times: frames.map((frame) => Math.round(frame.timestamp / 1000)),
      participants: participantIds.map((participantId) => {
        const series = frames.map((frame) => frame.participantFrames[String(participantId)]);
        return {
          participantId,
          gold: series.map((frame) => frame?.totalGold ?? 0),
          cs: series.map((frame) => (frame ? frame.minionsKilled + frame.jungleMinionsKilled : 0)),
          xp: series.map((frame) => frame?.xp ?? 0),
        };
      }),
    },
    events: { items, skills },
  };
}

// Riot reports an undone purchase as beforeId = item, afterId = 0, and an undone sale the other way round.
function undo(items: ItemEvent[], participantId: number, beforeId: number, afterId: number): void {
  const kind = beforeId ? 'buy' : 'sell';
  const itemId = beforeId || afterId;
  const index = items.findLastIndex(
    (item) => item.participantId === participantId && item.itemId === itemId && item.kind === kind,
  );
  if (index !== -1) {
    items.splice(index, 1);
  }
}
