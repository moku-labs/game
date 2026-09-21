/**
 * @file time plugin — state factory skeleton.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial time state: empty callback lists for the six phases, a zeroed `Time`
 * with scale 1, not paused, not running.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.global - Global framework config.
 * @param _ctx.config - Resolved plugin config.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const state = createTimeState({ global, config });
 * ```
 */
export function createTimeState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  throw new Error("not implemented");
}
