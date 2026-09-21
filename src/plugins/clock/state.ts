/**
 * @file clock plugin — state factory skeleton.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial clock state: the configured source or the system source, no due moment,
 * no timer handle, no listeners.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.global - Global framework config.
 * @param _ctx.config - Resolved plugin config.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const state = createClockState({ global, config });
 * ```
 */
export function createClockState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  throw new Error("not implemented");
}
