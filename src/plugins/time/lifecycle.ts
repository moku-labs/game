/**
 * @file time plugin — the single frame loop of the real frame source.
 */
import { teardown } from "../../teardown";
import { tickFrame } from "./api";
import type { TimeCtx } from "./types";

/**
 * Asks the platform for the next frame and remembers its handle, so `stopLoop` can cancel it.
 *
 * @param ctx - Domain context of the time plugin.
 * @example
 * ```ts
 * scheduleFrame(ctx);
 * ```
 */
function scheduleFrame(ctx: TimeCtx): void {
  ctx.state.rafId = globalThis.requestAnimationFrame(timestamp =>
    runAnimationFrame(ctx, timestamp)
  );
}

/**
 * Handles one frame of the platform: schedules the next one first, so a throwing frame cannot
 * kill the loop, then runs the frame.
 *
 * @param ctx - Domain context of the time plugin.
 * @param timestamp - Timestamp handed over by `requestAnimationFrame`, in milliseconds.
 * @example
 * ```ts
 * runAnimationFrame(ctx, performance.now());
 * ```
 */
function runAnimationFrame(ctx: TimeCtx, timestamp: number): void {
  scheduleFrame(ctx);
  tickFrame(ctx, timestamp);
}

/**
 * Cancels the pending frame and forgets the frame source. The registered disposer of the plugin.
 *
 * @param ctx - Domain context of the time plugin.
 * @example
 * ```ts
 * teardown.register(ctx.global, "time", () => stopLoop(ctx));
 * ```
 */
function stopLoop(ctx: TimeCtx): void {
  const { rafId } = ctx.state;

  if (rafId !== undefined) globalThis.cancelAnimationFrame(rafId);

  ctx.state.rafId = undefined;
  ctx.state.lastTimestamp = undefined;
  ctx.state.running = false;
}

/**
 * Starts the single `requestAnimationFrame` loop when the platform has one, and registers
 * the disposer that cancels it. In plain Bun the loop does not start and `isRunning` stays false.
 *
 * @param ctx - Domain context of the time plugin.
 * @example
 * ```ts
 * createPlugin("time", { onStart: startLoop });
 * ```
 */
export function startLoop(ctx: TimeCtx): void {
  if (typeof globalThis.requestAnimationFrame !== "function") return;

  ctx.state.running = true;
  scheduleFrame(ctx);
  teardown.register(ctx.global, "time", () => stopLoop(ctx));
}
