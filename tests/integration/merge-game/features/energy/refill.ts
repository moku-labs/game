/**
 * @file When the next energy point arrives, as the Out of energy popup says it: "Пополнится через
 * 9 мин 59 с". Pure: the moment and the bar come in, the wait in milliseconds goes out. The words
 * are the message's: `{time, duration, short}` formats the wait in the player's language.
 */
import type { MergeState } from "../../rules";

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
