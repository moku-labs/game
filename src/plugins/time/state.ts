/**
 * @file time plugin — state factory.
 */
import { createMeasureState } from "./measure";
import type { Config, State } from "./types";

/**
 * Creates the initial time state: empty callback lists for the six phases, a zeroed `Time`
 * with scale 1, not paused, not running, awake with an empty unscaled clock and no wake counted, nothing asked of
 * the native shell. An agent build also gets the measure state; a build without the flag gets
 * none, so its frames never measure.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @returns A fresh state, owned by one app.
 */
export function createTimeState(_ctx: { readonly config: Readonly<Config> }): State {
  return {
    // The key order is the call order of a frame; `PHASES` in phases.ts is the single source of it.
    callbacks: { input: [], animate: [], layout: [], sync: [], signals: [], render: [] },
    captured: [[], [], [], [], [], []],
    time: { delta: 0, elapsed: 0, scale: 1, frame: 0, idle: false },
    paused: false,
    running: false,
    stepping: false,
    rafId: undefined,
    lastTimestamp: undefined,
    unscaledElapsedMs: 0,
    lastWakeMs: 0,
    wakes: 0,
    idle: false,
    // Inline and positive: Bun folds the guard under a production `define`.
    measure:
      typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__
        ? createMeasureState()
        : undefined,
    shell: { warned: false, stopRate: undefined, removeThermal: undefined }
  };
}
