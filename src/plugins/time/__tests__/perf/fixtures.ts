/**
 * @file time plugin — the fixtures of the perf tests and benches. Not a test file. Each fixture builds a time context
 * with the adaptive frame rate on a 100 Hz panel and the render scale allowed down to 0.75, plays it into the state it
 * measures outside any window, and hands back one tick of the frame source the way `requestAnimationFrame` calls it.
 * The panel ticks and the page clock are whole milliseconds: a call hands them back unboxed, so a window counts the
 * engine's bytes alone (a browser's timestamp is boxed by the browser).
 */
import type { Log } from "@moku-labs/common/browser";
import { alloc } from "../../../../../tests/perf/alloc";
import { createTimeApi, tickFrame } from "../../api";
import { createTimeState } from "../../state";
import type { Config, TimeCtx } from "../../types";

/** Calls before a window: the tick reaches its optimized tier first, as on a phone after a few seconds. */
const WARM_CALLS = 30_000;

/** Calls of a window, ten times `alloc`'s default. */
const CALLS = 100_000;

/** One vsync of the 100 Hz panel, ms. */
const VSYNC_MS = 10;

/** A log that writes nothing: the switches of the warm-up log, a window never does. */
const SILENT = (): void => {};

/** The page clock every fixture's `performance.now()` answers, set to each tick's timestamp. */
const page = { now: 0 };

/** The real page clock, kept before a fixture replaces it: a bench times its runs with it. */
export const realNow: () => number = globalThis.performance.now.bind(globalThis.performance);

/**
 * The heap bytes one tick keeps: the tick run until V8 optimized it, outside the window, then `alloc` over a window of
 * `CALLS`.
 *
 * @param fn - The tick.
 * @returns Bytes per call.
 */
export function bytesPerCall(fn: () => void): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, CALLS);
}

/**
 * A time context of a 120 fps game with the adaptive rate and the scale down to 0.75, whose render phase spends 1 ms
 * on the page clock and reports the frame drawn, as the renderer does.
 *
 * @returns The context.
 */
function adaptiveTime(): TimeCtx {
  const config: Config = {
    maxFps: 120,
    maxDeltaMs: 50,
    idleFps: 0,
    idleAfterMs: 2000,
    adaptive: { floor: 60 }
  };
  // Partial mock of a complex external type: the levels a switch writes.
  const log = { info: SILENT, debug: SILENT, warn: SILENT, error: SILENT } as unknown as Log.LogApi;
  const ctx: TimeCtx = {
    global: {},
    config,
    state: createTimeState({ config }),
    emit: SILENT,
    log
  };
  const api = createTimeApi(ctx);

  // A plain function, not a spy: a spy records every call, which a window would count.
  globalThis.performance.now = (): number => page.now;
  api.onFrame("render", () => {
    page.now += 1;
    api.frameDrawn();
  });
  api.allowScale(0.75);

  return ctx;
}

/**
 * The ticks of a panel whose run frames come `pattern` vsyncs apart in turn, one tick per run frame, played for ten
 * seconds; throws when the rule did not settle at the rate and the scale the fixture measures.
 *
 * @param pattern - Vsyncs between run frames, repeated.
 * @param scale - The scale the rule must have settled at.
 * @returns One tick.
 * @throws {Error} When the rule is not at 100 fps and `scale` after the ten seconds.
 */
function ticksOf(pattern: readonly number[], scale: number): () => void {
  const ctx = adaptiveTime();
  const count = pattern.length;
  let at = 1000;
  let index = 0;
  const tick = (): void => {
    at += VSYNC_MS * (pattern[index % count] ?? 1);
    index += 1;
    page.now = at;
    tickFrame(ctx, at);
  };

  while (at < 11_000) tick();

  if (ctx.state.rate.fps !== 100 || ctx.state.rate.scale !== scale) {
    throw new Error(
      `fixtures: the rule is at ${ctx.state.rate.fps} fps, scale ${ctx.state.rate.scale}`
    );
  }

  return tick;
}

/**
 * A steady screen: every vsync runs a light frame, so the rule sits at the top of the ladder (100) and of the scale.
 *
 * @returns One tick, after the panel was learned.
 */
export function steadyTick(): () => void {
  return ticksOf([1], 1);
}

/**
 * A GPU-bound screen at the floor: every other frame takes two vsyncs, late. The rule steps the scale down to 0.75
 * and then has no step left; the on-time half keeps the panel's 100 Hz.
 *
 * @returns One tick, at the floor of the rate and of the scale.
 */
export function lateAtFloorTick(): () => void {
  return ticksOf([1, 2], 0.75);
}
