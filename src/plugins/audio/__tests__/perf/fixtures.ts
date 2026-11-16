/**
 * @file audio plugin — the calls the perf tests and benches measure: `forgetTrack`, which a music switch runs once
 * (F198). Not a test file: the perf project collects `*.perf.ts` and `*.bench.ts`.
 */
import { alloc } from "../../../../../tests/perf/alloc";
import { forgetTrack } from "../../playback";
import { createMockAudio } from "../unit/mock-audio";

/** Calls before a window: the call reaches its optimized tier first. */
const WARM_CALLS = 30_000;

/** Calls of a window. */
const CALLS = 100_000;

/**
 * The heap bytes one call keeps: the call run until V8 optimized it, outside the window, then `alloc` over a window
 * of `CALLS`.
 *
 * @param fn - The call.
 * @returns Bytes per call.
 */
export function bytesPerCall(fn: () => void): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, CALLS);
}

/**
 * A switch whose left key is the track that plays again: the cache keeps it.
 *
 * @returns The call a switch makes.
 */
export function forgetPlaying(): () => void {
  const { state } = createMockAudio();

  state.music = { key: "ui.music.theme", gain: undefined, source: undefined, stream: undefined };

  return () => forgetTrack(state, "ui.music.theme");
}

/**
 * A switch whose left key is decoded: the cache drops it. The entry goes back after each call, so every call drops
 * one.
 *
 * @returns The call a switch makes, and the put-back of the entry.
 */
export function forgetLeft(): () => void {
  const { state } = createMockAudio();
  const pending = Promise.resolve({} as AudioBuffer);

  state.music = { key: "ui.music.board", gain: undefined, source: undefined, stream: undefined };

  return () => {
    state.decoded.set("ui.music.theme", pending);
    forgetTrack(state, "ui.music.theme");
  };
}

/**
 * The control of `forgetLeft`: the same put-back and a plain `Map.delete`, no `forgetTrack`. What it keeps is the
 * Map's own table churn, not the drop.
 *
 * @returns The put-back and the delete.
 */
export function mapChurn(): () => void {
  const { state } = createMockAudio();
  const pending = Promise.resolve({} as AudioBuffer);

  return () => {
    state.decoded.set("ui.music.theme", pending);
    state.decoded.delete("ui.music.theme");
  };
}
