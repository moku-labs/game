/**
 * @file anim/timeline — the ring of the last 16 ended timelines and the snapshot `timelines()`
 * answers. The ring is written in place at every end, so an end allocates no record; the snapshot
 * builds new plain objects for a reader and is never on the frame path.
 */
import { ENDED_CAPACITY } from "../state";
import type {
  EndedTimelineInfo,
  RunningTimelineInfo,
  State,
  TimelineEndReason,
  TimelinesSnapshot
} from "../types";
import type { RunningTimeline } from "./types";

/**
 * Writes one end into the next slot of the ring, in place, and moves the ring on. The record that
 * was there is overwritten, so the 17th end evicts the oldest.
 *
 * @param state - The anim state that holds the ring.
 * @param running - The timeline that ended.
 * @param reason - How it ended.
 */
export function recordEnd(state: State, running: RunningTimeline, reason: TimelineEndReason): void {
  const record = state.ended[state.endedNext];

  if (record === undefined) return;

  record.timeline = running.id;
  record.animation = running.animation;
  record.startFrame = running.startFrame;
  record.endFrame = state.frame;
  record.reason = reason;

  state.endedNext = (state.endedNext + 1) % ENDED_CAPACITY;
  state.endedCount = Math.min(ENDED_CAPACITY, state.endedCount + 1);
}

/**
 * Resets the ring to empty. The 16 records stay allocated and are reused by the next ends.
 *
 * @param state - The anim state that holds the ring.
 */
export function resetRing(state: State): void {
  state.endedNext = 0;
  state.endedCount = 0;
}

/**
 * Describes one running timeline for a reader: new arrays for the entities and the marks, the
 * slots by reference.
 *
 * @param running - The running timeline.
 * @returns A plain object a caller may keep.
 */
function infoOf(running: RunningTimeline): RunningTimelineInfo {
  return {
    timeline: running.id,
    animation: running.animation,
    startFrame: running.startFrame,
    slots: running.slots,
    entities: [...running.entities],
    marks: [...running.marks]
  };
}

/**
 * Reads what plays now and the ring of what ended, for `timelines()`.
 *
 * @param state - The anim state.
 * @returns The running timelines in start order and the ended ones, oldest first.
 */
export function snapshotOf(state: State): TimelinesSnapshot {
  const running: RunningTimelineInfo[] = [];

  for (const timeline of state.timelineList) {
    if (!timeline.ended) running.push(infoOf(timeline));
  }

  const ended: EndedTimelineInfo[] = [];
  // The oldest record sits `endedCount` slots behind the next one to write.
  const first = (state.endedNext - state.endedCount + ENDED_CAPACITY) % ENDED_CAPACITY;

  for (let offset = 0; offset < state.endedCount; offset++) {
    const record = state.ended[(first + offset) % ENDED_CAPACITY];

    if (record === undefined) continue;

    ended.push({
      timeline: record.timeline,
      animation: record.animation,
      startFrame: record.startFrame,
      endFrame: record.endFrame,
      reason: record.reason
    });
  }

  return { running, ended };
}
