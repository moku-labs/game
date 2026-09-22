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
 * // The payload of the first `app.lifecycle.push("background")`.
 * const payload: Events["lifecycle:changed"] = {
 *   reason: "background", action: "push",
 *   reasons: ["background"], paused: true, resumed: false
 * };
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
 */
export type State = { reasons: PauseReason[] };

/**
 * lifecycle plugin API, `app.lifecycle`. The stack of reasons why the game is paused: the first
 * reason pauses `time`, the last one to leave resumes it, and every real change of the stack
 * emits `lifecycle:changed`.
 *
 * @example
 * ```ts
 * // Two reasons hold the pause, so they never cancel each other.
 * app.lifecycle.push("background"); // time pauses
 * app.lifecycle.push("ad"); // still one pause
 * app.lifecycle.pop("background"); // still paused: "ad" holds
 * app.lifecycle.pop("ad"); // time resumes
 * ```
 */
export type Api = {
  /**
   * Pushes a reason why the game is paused. A reason already on the stack is ignored, so two
   * plugins pausing for the same reason never pause twice.
   *
   * @param reason - Why the game is paused.
   * @example
   * ```ts
   * // A rewarded ad covers the game: the world stands while it plays.
   * app.lifecycle.push("ad"); // app.time.isPaused() is true, "lifecycle:changed" is emitted
   * app.lifecycle.push("ad"); // already on the stack: no second pause, no event
   * ```
   */
  push(reason: PauseReason): void;

  /**
   * Pops a reason. The game runs again only when the last reason leaves. A reason that is not
   * on the stack is ignored.
   *
   * @param reason - The reason that no longer holds.
   * @example
   * ```ts
   * // The tab is visible again. The game runs, unless another reason still holds.
   * document.addEventListener("visibilitychange", () => {
   *   if (!document.hidden) app.lifecycle.pop("background");
   * });
   * ```
   */
  pop(reason: PauseReason): void;

  /**
   * Reads the stack as a frozen copy, in insertion order, so a caller cannot write into it.
   *
   * @returns The pause reasons currently held.
   * @example
   * ```ts
   * // A debug overlay shows why the game stands still.
   * app.lifecycle.push("background");
   * app.lifecycle.push("ad");
   * app.lifecycle.reasons(); // ["background", "ad"]
   * ```
   */
  reasons(): readonly PauseReason[];

  /**
   * Tells whether the game is paused: true while the stack is not empty.
   *
   * @returns True while at least one reason holds.
   * @example
   * ```ts
   * // The idle hint must not start behind a system dialog.
   * app.lifecycle.push("system-dialog");
   * app.lifecycle.isPaused(); // true
   * ```
   */
  isPaused(): boolean;
};

/**
 * Domain context: the kernel context with `require`, used to reach `time`. `emit` is the kernel's:
 * `index.ts` writes `events` with an annotated `register` (core spec `14` row 8), so the own event
 * reaches a factory passed by direct reference.
 */
export type LifecycleCtx = PluginCtx<Config, State, Events> & {
  readonly require: Require;
};
