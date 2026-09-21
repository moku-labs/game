/**
 * Standard tier — single rAF loop, six frame phases, the Time resource. Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { createTimeApi } from "./api";
import { startLoop, stopLoop } from "./lifecycle";
import { createTimeState } from "./state";
import type { Config } from "./types";

const config: Config = { maxFps: 60, maxDeltaMs: 50 };

/**
 * Time plugin: `app.time.onFrame(phase, fn)`, `app.time.step(dt)`.
 *
 * @example
 * ```ts
 * // A game plugin with frame work declares the dependency and registers a callback on start.
 * const sparklePlugin = createPlugin("sparkle", {
 *   depends: [timePlugin],
 *   onStart: ctx => void ctx.require(timePlugin).onFrame("animate", time => advance(time.delta))
 * });
 * ```
 */
export const timePlugin = /*#__PURE__*/ createPlugin("time", {
  config,
  createState: createTimeState,
  api: createTimeApi,
  onStart: startLoop,
  // @no-resource-check — onStop cancels the requestAnimationFrame handle.
  onStop: ({ state }) => stopLoop(state)
});
