/**
 * @file clock plugin — lifecycle functions skeleton.
 */
import type { ClockCtx } from "./types";

/**
 * Registers the disposer that clears the pending timer. The disposer reads state at stop time,
 * because the handle does not exist yet at start. No timer is created here.
 *
 * @param _ctx - Domain context of the clock plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * createPlugin("clock", { onStart: registerClockTeardown });
 * ```
 */
export function registerClockTeardown(_ctx: ClockCtx): void {
  throw new Error("not implemented");
}
