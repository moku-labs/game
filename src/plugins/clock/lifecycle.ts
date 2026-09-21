/**
 * @file clock plugin — lifecycle functions.
 */
import { teardown } from "../../teardown";
import type { ClockCtx } from "./types";

/**
 * Registers the disposer that clears the pending timer. The disposer reads state at stop time,
 * because the handle does not exist yet at start. No timer is created here.
 *
 * @param ctx - Domain context of the clock plugin.
 * @example
 * ```ts
 * createPlugin("clock", { onStart: registerClockTeardown });
 * ```
 */
export function registerClockTeardown(ctx: ClockCtx): void {
  teardown.register(ctx.global, "clock", () => ctx.state.source.clearTimer(ctx.state.handle));
}
