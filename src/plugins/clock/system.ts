/**
 * @file clock plugin — system time source. The one file allowed to read the device clock (lint L3).
 */
import type { ClockSource } from "./types";

/**
 * Handle handed out by the system source: the platform timer, wrapped so that a foreign value
 * passed to `clearTimer` is recognised and ignored.
 *
 */
type SystemTimer = { readonly timer: ReturnType<typeof setTimeout> };

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
 * @returns A source reading `Date.now` and scheduling with `setTimeout`.
 */
export function systemSource(): ClockSource {
  return {
    now: (): number => Date.now(),

    setTimer: (callback: () => void, delayMs: number): SystemTimer => ({
      timer: setTimeout(callback, delayMs)
    }),

    clearTimer: (handle: unknown): void => {
      if (!isSystemTimer(handle)) return;

      clearTimeout(handle.timer);
    }
  };
}
