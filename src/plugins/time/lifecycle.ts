/**
 * @file time plugin — lifecycle functions skeleton.
 */
import type { TimeCtx } from "./types";

/**
 * Starts the single `requestAnimationFrame` loop when the platform has one, and registers
 * the disposer that cancels it. In plain Bun the loop does not start and `isRunning` stays false.
 *
 * @param _ctx - Domain context of the time plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * createPlugin("time", { onStart: startLoop });
 * ```
 */
export function startLoop(_ctx: TimeCtx): void {
  throw new Error("not implemented");
}
