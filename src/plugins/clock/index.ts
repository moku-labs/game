/**
 * Standard tier — trusted time as an input: monotonic `now()`, one `elapsed` signal at the next
 * due moment. Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { cancelPending, createClockApi } from "./api";
import { createClockState } from "./state";
import type { Config } from "./types";

const config: Config = { source: undefined };

/**
 * Clock plugin: `app.clock.now()`, `app.clock.scheduleAt(moment)`, `app.clock.onElapsed(fn)`.
 *
 * @example
 * ```ts
 * ctx.require(clockPlugin).scheduleAt(nextDue);
 * ```
 */
export const clockPlugin = /*#__PURE__*/ createPlugin("clock", {
  config,
  createState: createClockState,
  api: createClockApi,
  // @no-resource-check — onStop clears the pending timer.
  onStop: ({ state }) => cancelPending(state)
});
