/**
 * @file time plugin — state factory.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial time state: empty callback lists for the six phases, a zeroed `Time`
 * with scale 1, not paused, not running.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.global - Global framework config.
 * @param _ctx.config - Resolved plugin config.
 * @returns A fresh state, owned by one app.
 * @example
 * ```ts
 * const state = createTimeState({ global, config });
 * ```
 */
export function createTimeState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return {
    // The key order is the call order of a frame; `PHASES` in api.ts is the single source of it.
    callbacks: { input: [], animate: [], layout: [], sync: [], signals: [], render: [] },
    time: { delta: 0, elapsed: 0, scale: 1, frame: 0 },
    paused: false,
    running: false,
    stepping: false,
    rafId: undefined,
    lastTimestamp: undefined
  };
}
