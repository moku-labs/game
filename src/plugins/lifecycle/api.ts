/**
 * @file lifecycle plugin — the pause reason stack and the API factory.
 */
import { timePlugin } from "../time";
import type { Api as TimeApi } from "../time/types";
import type { Api, LifecycleCtx, PauseReason } from "./types";

/**
 * Emits `lifecycle:changed` for one real change of the stack. The payload carries a frozen
 * snapshot, so a listener that keeps it sees the stack as it was at that moment.
 *
 * @param ctx - Domain context of the lifecycle plugin.
 * @param reason - The reason that was pushed or popped.
 * @param action - What happened to that reason.
 * @param resumed - True only on the change that emptied the stack.
 * @example
 * ```ts
 * announce(ctx, "background", "push", false);
 * ```
 */
function announce(
  ctx: LifecycleCtx,
  reason: PauseReason,
  action: "push" | "pop",
  resumed: boolean
): void {
  const reasons = Object.freeze([...ctx.state.reasons]);

  ctx.emit("lifecycle:changed", { reason, action, reasons, paused: reasons.length > 0, resumed });
}

/**
 * Adds a reason to the end of the stack. A reason that is already there changes nothing: no
 * state change, no `time` call, no event. The first reason on an empty stack pauses `time`.
 *
 * @param ctx - Domain context of the lifecycle plugin.
 * @param time - API of the time plugin, which sits below lifecycle.
 * @param reason - Why the game is paused.
 * @example
 * ```ts
 * pushReason(ctx, time, "background");
 * ```
 */
function pushReason(ctx: LifecycleCtx, time: TimeApi, reason: PauseReason): void {
  if (ctx.state.reasons.includes(reason)) return;

  const wasEmpty = ctx.state.reasons.length === 0;

  ctx.state.reasons.push(reason);

  // The world stands while the stack is not empty, so only the first reason stops the clock.
  if (wasEmpty) time.pause();

  announce(ctx, reason, "push", false);
}

/**
 * Removes a reason from the stack. A reason that is not there changes nothing: no state change,
 * no `time` call, no event. The last reason to leave resumes `time`.
 *
 * @param ctx - Domain context of the lifecycle plugin.
 * @param time - API of the time plugin, which sits below lifecycle.
 * @param reason - The reason that no longer holds.
 * @example
 * ```ts
 * popReason(ctx, time, "background");
 * ```
 */
function popReason(ctx: LifecycleCtx, time: TimeApi, reason: PauseReason): void {
  const index = ctx.state.reasons.indexOf(reason);

  if (index === -1) return;

  ctx.state.reasons.splice(index, 1);

  const resumed = ctx.state.reasons.length === 0;

  if (resumed) time.resume();

  announce(ctx, reason, "pop", resumed);
}

/**
 * Creates the lifecycle API: `push` and `pop` of pause reasons, a frozen copy of the stack and
 * `isPaused`. The first reason pauses `time`, the last one to leave resumes it, and every real
 * change of the stack emits `lifecycle:changed`. Resolves `time` with `ctx.require` inside:
 * `time` sits below lifecycle, so pausing it is a direct call, never an event.
 *
 * @param ctx - Domain context of the lifecycle plugin.
 * @returns The public API of the lifecycle plugin.
 * @example
 * ```ts
 * const api = createLifecycleApi(ctx);
 * api.push("background");
 * ```
 */
export function createLifecycleApi(ctx: LifecycleCtx): Api {
  const time = ctx.require(timePlugin);

  return {
    /**
     * Pushes a reason why the game is paused. A reason already on the stack is ignored, so two
     * plugins pausing for the same reason never pause twice.
     *
     * @param reason - Why the game is paused.
     * @example
     * ```ts
     * lifecycle.push("background");
     * ```
     */
    push: reason => {
      pushReason(ctx, time, reason);
    },

    /**
     * Pops a reason. The game runs again only when the last reason leaves. A reason that is not
     * on the stack is ignored.
     *
     * @param reason - The reason that no longer holds.
     * @example
     * ```ts
     * lifecycle.pop("background");
     * ```
     */
    pop: reason => {
      popReason(ctx, time, reason);
    },

    /**
     * Reads the stack as a frozen copy, in insertion order, so a caller cannot write into it.
     *
     * @returns The pause reasons currently held.
     * @example
     * ```ts
     * const holding = lifecycle.reasons();
     * ```
     */
    reasons: () => Object.freeze([...ctx.state.reasons]),

    /**
     * Tells whether the game is paused: true while the stack is not empty.
     *
     * @returns True while at least one reason holds.
     * @example
     * ```ts
     * if (lifecycle.isPaused()) showPauseScreen();
     * ```
     */
    isPaused: () => ctx.state.reasons.length > 0
  };
}
