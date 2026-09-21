/**
 * @file clock plugin — state factory.
 */
import { systemSource } from "./system";
import type { Config, State } from "./types";

/**
 * Creates the initial clock state: the configured source or the system source, no due moment,
 * no timer handle, no listeners.
 *
 * @param ctx - Minimal context.
 * @param ctx.config - Resolved plugin config.
 * @returns A fresh clock state.
 * @example
 * ```ts
 * const state = createClockState({ config: { source: fakeClock(1000) } });
 * ```
 */
export function createClockState(ctx: { readonly config: Readonly<Config> }): State {
  return {
    source: ctx.config.source ?? systemSource(),
    last: 0,
    dueAt: undefined,
    handle: undefined,
    listeners: []
  };
}
