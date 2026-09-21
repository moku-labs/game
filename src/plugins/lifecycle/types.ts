/**
 * @file lifecycle plugin — type definitions.
 */
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";

/**
 * Why the game is paused. The named reasons are the engine's own; any other string is allowed.
 *
 * @example
 * ```ts
 * const reason: PauseReason = "background";
 * ```
 */
export type PauseReason =
  | "background"
  | "devtools"
  | "system-dialog"
  | "device-lost"
  | (string & {});

/**
 * lifecycle plugin events.
 *
 * @example
 * ```ts
 * const onChanged = (payload: Events["lifecycle:changed"]) => payload.resumed;
 * ```
 */
export type Events = {
  /**
   * The pause stack changed. `reason` and `action` say what changed; `resumed` is true only on
   * the change that emptied the stack.
   */
  "lifecycle:changed": {
    reason: PauseReason;
    action: "push" | "pop";
    reasons: readonly PauseReason[];
    paused: boolean;
    resumed: boolean;
  };
};

/**
 * lifecycle plugin config: none. The plugin has no tunable behaviour.
 *
 * @example
 * ```ts
 * const config: Config = {};
 * ```
 */
export type Config = Record<string, never>;

/**
 * lifecycle plugin state: the pause reasons in insertion order, no duplicates.
 *
 * @example
 * ```ts
 * const state: State = { reasons: ["background"] };
 * ```
 */
export type State = { reasons: PauseReason[] };

/**
 * lifecycle plugin API.
 *
 * @example
 * ```ts
 * const lifecycle: Api = ctx.require(lifecyclePlugin);
 * lifecycle.push("background");
 * ```
 */
export type Api = {
  push(reason: PauseReason): void;
  pop(reason: PauseReason): void;
  reasons(): readonly PauseReason[];
  isPaused(): boolean;
};

/**
 * Domain context: the kernel slice with `require`, used to reach `time`.
 * `emit` is a method signature on purpose: a property-typed `emit` breaks the kernel's event
 * inference when a factory is passed to `createPlugin` by direct reference (`api`).
 *
 * @example
 * ```ts
 * const api = createLifecycleApi(ctx satisfies LifecycleCtx);
 * ```
 */
export type LifecycleCtx = Omit<PluginCtx<Config, State, Events>, "emit"> & {
  emit<Name extends keyof Events>(name: Name, payload: Events[Name]): void;
  readonly require: Require;
};
