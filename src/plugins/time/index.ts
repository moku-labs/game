/**
 * Standard tier — single rAF loop, six frame phases, the Time resource, the measurement of an
 * agent build, the adaptive frame rate and the native shell's frame rate. Emits `time:thermal`
 * and `time:rate`.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createPlugin } from "../../config";
import { createTimeApi } from "./api";
import { startTime, stopTime } from "./lifecycle";
import { createTimeState } from "./state";
import type { Config, Events } from "./types";

const config: Config = {
  maxFps: 60,
  maxDeltaMs: 50,
  idleFps: 30,
  idleAfterMs: 2000,
  adaptive: false
};

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
  events: (register: RegisterFunction) =>
    register.map<Events>({
      "time:thermal": "The native shell reported a thermal reading",
      "time:rate": "The loop's frame rate changed"
    }),
  createState: createTimeState,
  api: createTimeApi,
  onStart: startTime,
  // @no-resource-check — onStop cancels the requestAnimationFrame handle, hands the frame rate
  // back to the native shell and removes the thermal listener.
  onStop: ({ state }) => stopTime(state)
});
