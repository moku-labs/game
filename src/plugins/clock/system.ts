/**
 * @file clock plugin — system time source. The one file allowed to read the device clock (lint L3).
 */
import type { ClockSource } from "./types";

/**
 * The longest delay a platform timer keeps, 2^31−1 ms (24.8 days). A longer one overflows and
 * fires at once (F151), so a longer wait is made of steps of this length.
 */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Handle handed out by the system source: the platform timer of the current step, wrapped so
 * that a foreign value passed to `clearTimer` is recognised and ignored.
 *
 */
type SystemTimer = { timer: ReturnType<typeof setTimeout> | undefined };

/**
 * Waits `delayMs` on platform timers, one step of at most `MAX_TIMER_MS` at a time, and calls
 * the callback once, after the last step. The handle always holds the step now pending.
 *
 * @param handle - The handle the steps write their timer to.
 * @param callback - Called once the whole delay is over.
 * @param delayMs - The delay still to wait.
 */
function step(handle: SystemTimer, callback: () => void, delayMs: number): void {
  if (delayMs <= MAX_TIMER_MS) {
    handle.timer = setTimeout(callback, delayMs);
    return;
  }

  handle.timer = setTimeout(() => step(handle, callback, delayMs - MAX_TIMER_MS), MAX_TIMER_MS);
}

/**
 * Tells whether a handle was produced by this source.
 *
 * @param handle - Handle given back to `clearTimer`.
 * @returns `true` when the handle carries a platform timer.
 * @example
 * ```ts
 * isSystemTimer({ timer: 7 }); // true
 * isSystemTimer(7); // false: a handle of another source is ignored
 * ```
 */
function isSystemTimer(handle: unknown): handle is SystemTimer {
  return typeof handle === "object" && handle !== null && "timer" in handle;
}

/**
 * Creates the system source: epoch milliseconds from the device clock and real timers.
 *
 * @returns A source reading `Date.now` and scheduling with `setTimeout`, for a delay of any length.
 */
export function systemSource(): ClockSource {
  return {
    now: (): number => Date.now(),

    setTimer: (callback: () => void, delayMs: number): SystemTimer => {
      const handle: SystemTimer = { timer: undefined };

      step(handle, callback, delayMs);
      return handle;
    },

    clearTimer: (handle: unknown): void => {
      if (!isSystemTimer(handle)) return;

      clearTimeout(handle.timer);
    }
  };
}
