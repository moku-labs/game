/**
 * @file time plugin — the single frame loop of the real frame source.
 */
import { tickFrame } from "./api";
import type { State, TimeCtx } from "./types";

/**
 * Builds the frame function of the loop, once per app, so a frame allocates no closure. Each call
 * schedules the next frame first, so a throwing frame cannot kill the loop, remembers the handle
 * for `stopLoop`, then runs the frame.
 *
 * @param ctx - Domain context of the time plugin.
 * @returns The function handed to `requestAnimationFrame` on every frame.
 */
function createFrameFunction(ctx: TimeCtx): (timestamp: number) => void {
  /**
   * One frame of the platform.
   *
   * @param timestamp - Timestamp handed over by `requestAnimationFrame`, in milliseconds.
   */
  const onFrame = (timestamp: number): void => {
    ctx.state.rafId = globalThis.requestAnimationFrame(onFrame);
    tickFrame(ctx, timestamp);
  };

  return onFrame;
}

/**
 * Cancels the pending frame and forgets the frame source. The `onStop` of the plugin: since
 * core 1.6 the kernel hands the plugin its own state at stop.
 *
 * @param state - State of the time plugin.
 */
export function stopLoop(state: State): void {
  const { rafId } = state;

  if (rafId !== undefined) globalThis.cancelAnimationFrame(rafId);

  state.rafId = undefined;
  state.lastTimestamp = undefined;
  state.running = false;
}

/**
 * Starts the single `requestAnimationFrame` loop when the platform has one. In plain Bun the loop does not start and `isRunning` stays false.
 *
 * @param ctx - Domain context of the time plugin.
 */
export function startLoop(ctx: TimeCtx): void {
  if (typeof globalThis.requestAnimationFrame !== "function") return;

  ctx.state.running = true;
  ctx.state.rafId = globalThis.requestAnimationFrame(createFrameFunction(ctx));
}
