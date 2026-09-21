/**
 * Standard tier — pause reason stack. Pauses `time` by a direct call. Emits `lifecycle:changed`.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { timePlugin } from "../time";
import { createLifecycleApi } from "./api";
import { createLifecycleState } from "./state";
import type { Events } from "./types";

/**
 * Lifecycle plugin: `app.lifecycle.push(reason)`, `app.lifecycle.pop(reason)`.
 *
 * @example
 * ```ts
 * ctx.require(lifecyclePlugin).push("background");
 * ```
 */
export const lifecyclePlugin = /*#__PURE__*/ createPlugin("lifecycle", {
  depends: [timePlugin],
  events: register =>
    register.map<Events>({ "lifecycle:changed": "The pause reason stack changed" }),
  createState: createLifecycleState,
  api: createLifecycleApi
});
