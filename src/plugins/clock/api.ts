/**
 * @file clock plugin — API factory skeleton.
 */
import type { Api, ClockCtx } from "./types";

/**
 * Creates the clock API: a monotonic `now()`, the single pending due moment, the `elapsed`
 * listeners and `poke` for resume from background.
 *
 * @param _ctx - Domain context of the clock plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const api = createClockApi(ctx);
 * api.scheduleAt(api.now() + 60_000);
 * ```
 */
export function createClockApi(_ctx: ClockCtx): Api {
  throw new Error("not implemented");
}
