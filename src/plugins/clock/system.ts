/**
 * @file clock plugin — system time source. The one file allowed to read the device clock (lint L3).
 */
import type { ClockSource } from "./types";

/**
 * Handle handed out by the system source: the platform timer, wrapped so that a foreign value
 * passed to `clearTimer` is recognised and ignored.
 *
 * @example
 * ```ts
 * const handle: SystemTimer = { timer: setTimeout(fire, 0) };
 * ```
 */
type SystemTimer = { readonly timer: ReturnType<typeof setTimeout> };

/**
 * Tells whether a handle was produced by this source.
 *
 * @param handle - Handle given back to `clearTimer`.
 * @returns `true` when the handle carries a platform timer.
 * @example
 * ```ts
 * if (isSystemTimer(handle)) clearTimeout(handle.timer);
 * ```
 */
function isSystemTimer(handle: unknown): handle is SystemTimer {
  return typeof handle === "object" && handle !== null && "timer" in handle;
}

/**
 * Creates the system source: epoch milliseconds from the device clock and real timers.
 *
 * @returns A source reading `Date.now` and scheduling with `setTimeout`.
 * @example
 * ```ts
 * const source = systemSource();
 * const moment = source.now();
 * ```
 */
export function systemSource(): ClockSource {
  return {
    /**
     * Reads the device clock.
     *
     * @returns Epoch milliseconds, an integer.
     * @example
     * ```ts
     * const moment = source.now();
     * ```
     */
    now: (): number => Date.now(),

    /**
     * Schedules one callback.
     *
     * @param callback - Function to run when the delay has passed.
     * @param delayMs - Delay in milliseconds.
     * @returns The handle to give back to `clearTimer`.
     * @example
     * ```ts
     * const handle = source.setTimer(fire, 1000);
     * ```
     */
    setTimer: (callback: () => void, delayMs: number): SystemTimer => ({
      timer: setTimeout(callback, delayMs)
    }),

    /**
     * Cancels a pending timer. An unknown handle is ignored.
     *
     * @param handle - Handle returned by `setTimer`.
     * @example
     * ```ts
     * source.clearTimer(handle);
     * ```
     */
    clearTimer: (handle: unknown): void => {
      if (!isSystemTimer(handle)) return;

      clearTimeout(handle.timer);
    }
  };
}
