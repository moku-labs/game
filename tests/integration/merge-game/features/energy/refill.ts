/**
 * @file When the next energy point arrives, as the Out of energy popup says it: "Пополнится через
 * 09:59". Pure: the moment and the bar come in, the words go out. The time is formatted once,
 * when the popup opens; a live countdown needs a ticking label the engine does not have yet.
 */
import type { MergeState } from "../../rules";

/** Milliseconds in one second and seconds in one minute. */
const second = 1000;

/** Seconds in one minute. */
const minute = 60;

/**
 * How long until the bar gains its next point. A full bar gains nothing, so it waits no time.
 *
 * @param energy - The energy bar, already caught up to `now`.
 * @param now - The current moment in milliseconds.
 * @param regenMs - How long one point takes.
 * @returns The milliseconds to wait, never below zero.
 * @example
 * ```ts
 * refillIn({ value: 0, max: 10, countedAt: 1000 }, 1000, 600_000); // 600000
 * ```
 */
export function refillIn(energy: MergeState["energy"], now: number, regenMs: number): number {
  if (energy.value >= energy.max) return 0;

  return Math.max(0, energy.countedAt + regenMs - now);
}

/**
 * A wait as minutes and seconds, rounded up to the next whole second.
 *
 * @param ms - The wait in milliseconds.
 * @returns The wait as `mm:ss`.
 * @example
 * ```ts
 * clockOf(599_000); // "09:59"
 * clockOf(599_001); // "10:00"
 * ```
 */
export function clockOf(ms: number): string {
  const seconds = Math.ceil(ms / second);
  const whole = Math.floor(seconds / minute);

  return `${String(whole).padStart(2, "0")}:${String(seconds % minute).padStart(2, "0")}`;
}
