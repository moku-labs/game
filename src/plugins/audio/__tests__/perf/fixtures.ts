/**
 * @file audio plugin — the calls the perf tests and benches measure: `forgetTrack`, which a music switch runs once
 * (F198), and the two checks of a loop (F239): `stopSceneLoops`, which every `scenes:changed` runs, and
 * `isSameLoop`, which every loop request runs. Not a test file: the perf project collects `*.perf.ts` and
 * `*.bench.ts`.
 */
import { alloc } from "../../../../../tests/perf/alloc";
import { isSameLoop, stopSceneLoops } from "../../loops";
import { forgetTrack } from "../../playback";
import type { AudioContextLike, LoopSound, NamedSound, State } from "../../types";
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

/** A gain whose schedules record nothing, so a fade measures the plugin and not the fake. */
const SILENT_GAIN = {
  gain: {
    value: 1,
    setValueAtTime: (): void => undefined,
    linearRampToValueAtTime: (): void => undefined
  }
} as unknown as GainNode;

/** A source whose stop records nothing. */
const SILENT_SOURCE = { stop: (): void => undefined } as unknown as AudioBufferSourceNode;

/** A context with a clock and nothing else: `fadeNamed` reads `currentTime` only. */
const SILENT_CONTEXT = { currentTime: 4 } as unknown as AudioContextLike;

/** One loop of the fixtures: its id, the loop `loops` keeps and the named sound that plays it. */
type Slot = { id: string; loop: LoopSound; sound: NamedSound };

/**
 * A state with a context that schedules nothing, and two playing loops of one scene, each with its named sound.
 *
 * @param scene - The scene both loops were asked for in.
 * @returns The state and the two loops.
 */
function sceneWithLoops(scene: string): { state: State; slots: Slot[] } {
  const { state } = createMockAudio();
  const slots = ["rain", "hum"].map(id => ({
    id,
    loop: { key: `${id}.room`, bus: "sfx" as const, fadeMs: 600, scene, started: true },
    sound: { gain: SILENT_GAIN, source: SILENT_SOURCE }
  }));

  state.context = SILENT_CONTEXT;
  putBack(state, slots);

  return { state, slots };
}

/**
 * Puts the two loops and their named sounds back under their ids, as they were before a leave.
 *
 * @param state - The plugin state.
 * @param slots - The two loops.
 */
function putBack(state: State, slots: Slot[]): void {
  for (const slot of slots) {
    state.loops.set(slot.id, slot.loop);
    state.named.set(slot.id, slot.sound);
  }
}

/**
 * The leave of a scene no loop belongs to: an empty map.
 *
 * @returns The walk a `scenes:changed` makes.
 */
export function leaveWithoutLoops(): () => void {
  const { state } = createMockAudio();

  state.context = SILENT_CONTEXT;

  return () => stopSceneLoops(state, "ward", 600);
}

/**
 * The leave of a scene while two loops of another scene play: the walk looks at both and stops neither.
 *
 * @returns The walk a `scenes:changed` makes.
 */
export function leaveOtherScene(): () => void {
  const { state } = sceneWithLoops("hall");

  return () => stopSceneLoops(state, "ward", 600);
}

/**
 * The leave of the scene two loops belong to: both fade out and leave both maps. They go back after each call, so
 * every call stops two.
 *
 * @returns The put-back of the two loops and the walk a `scenes:changed` makes.
 */
export function leaveTwoLoops(): () => void {
  const { state, slots } = sceneWithLoops("ward");

  return () => {
    putBack(state, slots);
    stopSceneLoops(state, "ward", 600);
  };
}

/**
 * The control of `leaveTwoLoops`: the same put-back and plain deletes of both maps, no walk. What it keeps is the
 * Maps' own table churn, not the stop.
 *
 * @returns The put-back and the deletes.
 */
export function loopChurn(): () => void {
  const { state, slots } = sceneWithLoops("ward");

  return () => {
    putBack(state, slots);

    for (const slot of slots) {
      state.loops.delete(slot.id);
      state.named.delete(slot.id);
    }
  };
}

/**
 * A loop request for the bed that already plays under its id: the check answers true and nothing else runs.
 *
 * @returns The check a loop request makes.
 */
export function sameLoop(): () => void {
  const { state } = sceneWithLoops("ward");

  return () => {
    isSameLoop(state, "rain", "rain.room");
  };
}
