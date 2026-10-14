/**
 * @file time plugin — the single frame loop of the real frame source, and what `time` asks of
 * the native shell for the length of the app.
 */
import { tickFrame } from "./api";
import { followNativeRate, stopShell, watchThermal } from "./native";
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
 * Cancels the pending frame and forgets the frame source. Since core 1.6 the kernel hands the
 * plugin its own state at stop.
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

/**
 * The `onStart` of the plugin: the frame loop, then the frame rate asked of the native shell and,
 * on the shell in an agent build, the one thermal listener. The shell exists only in the page, so
 * its requests follow the app's life.
 *
 * @param ctx - Domain context of the time plugin.
 */
export function startTime(ctx: TimeCtx): void {
  startLoop(ctx);
  followNativeRate(ctx);
  watchThermal(ctx);
}

/**
 * The `onStop` of the plugin: the loop stops, the frame rate goes back to the shell and the
 * thermal listener is removed.
 *
 * @param state - State of the time plugin.
 */
export function stopTime(state: State): void {
  stopLoop(state);
  stopShell(state);
}
