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
 */
export function createLifecycleApi(ctx: LifecycleCtx): Api {
  const time = ctx.require(timePlugin);

  return {
    push: reason => {
      pushReason(ctx, time, reason);
    },

    pop: reason => {
      popReason(ctx, time, reason);
    },

    reasons: () => Object.freeze([...ctx.state.reasons]),

    isPaused: () => ctx.state.reasons.length > 0
  };
}
