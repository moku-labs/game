/**
 * @file time plugin — the single frame loop of the real frame source.
 */
import { teardown } from "../../teardown";
import { tickFrame } from "./api";
import type { TimeCtx } from "./types";

/**
 * Builds the frame function of the loop, once per app, so a frame allocates no closure. Each call
 * schedules the next frame first, so a throwing frame cannot kill the loop, remembers the handle
 * for `stopLoop`, then runs the frame.
 *
 * @param ctx - Domain context of the time plugin.
 * @returns The function handed to `requestAnimationFrame` on every frame.
 * @example
 * ```ts
 * const onFrame = createFrameFunction(ctx);
 * ctx.state.rafId = requestAnimationFrame(onFrame);
 * ```
 */
function createFrameFunction(ctx: TimeCtx): (timestamp: number) => void {
  /**
   * One frame of the platform.
   *
   * @param timestamp - Timestamp handed over by `requestAnimationFrame`, in milliseconds.
   * @example
   * ```ts
   * onFrame(performance.now());
   * ```
   */
  const onFrame = (timestamp: number): void => {
    ctx.state.rafId = globalThis.requestAnimationFrame(onFrame);
    tickFrame(ctx, timestamp);
  };

  return onFrame;
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
  ctx.state.rafId = globalThis.requestAnimationFrame(createFrameFunction(ctx));
  teardown.register(ctx.global, "time", () => stopLoop(ctx));
}
