/**
 * Standard tier — trusted time as an input: monotonic `now()`, one `elapsed` signal at the next
 * due moment. Stands while the game is paused for `devtools` (F169). Emits no events.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { lifecyclePlugin } from "../lifecycle";
import { cancelPending, createClockApi } from "./api";
import { createHandlers } from "./handlers";
import { createClockState } from "./state";
import type { Config } from "./types";

const config: Config = { source: undefined };

/**
 * Clock plugin: `app.clock.now()`, `app.clock.scheduleAt(moment)`, `app.clock.onElapsed(fn)`.
 *
 * @example
 * ```ts
 * // A game plugin that needs trusted time declares the dependency and asks for the API.
 * const energyPlugin = createPlugin("energy", {
 *   depends: [clockPlugin],
 *   api: ctx => ({ fullAt: (missing: number) => ctx.require(clockPlugin).now() + missing * 60_000 })
 * });
 * ```
 */
export const clockPlugin = /*#__PURE__*/ createPlugin("clock", {
  // lifecyclePlugin: no API is required; the edge types the `lifecycle:changed` hook.
  depends: [lifecyclePlugin],
  config,
  createState: createClockState,
  api: createClockApi,
  hooks: createHandlers,
  // @no-resource-check — onStop clears the pending timer.
  onStop: ({ state }) => cancelPending(state)
});
