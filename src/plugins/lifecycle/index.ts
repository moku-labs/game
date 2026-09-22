/**
 * Standard tier — pause reason stack. Pauses `time` by a direct call. Emits `lifecycle:changed`.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
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
 * // A game plugin that reacts to the pause declares the dependency and hooks the event.
 * const musicPlugin = createPlugin("music", {
 *   depends: [lifecyclePlugin],
 *   hooks: () => ({ "lifecycle:changed": ({ paused }) => music.setMuted(paused) })
 * });
 * ```
 */
export const lifecyclePlugin = /*#__PURE__*/ createPlugin("lifecycle", {
  depends: [timePlugin],
  events: (register: RegisterFunction) =>
    register.map<Events>({ "lifecycle:changed": "The pause reason stack changed" }),
  createState: createLifecycleState,
  api: createLifecycleApi
});
