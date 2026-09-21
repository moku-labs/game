/**
 * @file Merge kit — time catch-up skeleton. The moment arrives as an input, never from the device.
 */
import type { MergeState, Tables } from "./types";

/**
 * Catches the state up to `_now`: energy regeneration and generator recharge from the stored
 * moments, with caps. `_now` earlier than `countedAt` counts as zero elapsed (tamper rule).
 *
 * @param _state - The rule state; it is not mutated.
 * @param _now - The current moment in integer milliseconds.
 * @param _tables - The content tables; they give the energy rule and the generator cooldowns.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const caughtUp = elapse(player.merge, now, tables);
 * ```
 */
export function elapse(_state: MergeState, _now: number, _tables: Tables): MergeState {
  throw new Error("not implemented");
}

/**
 * Returns the nearest future moment at which `elapse` changes the state, or `undefined` when
 * nothing is pending. Every timer kind handled by `elapse` appears here.
 *
 * @param _state - The rule state to read.
 * @param _tables - The content tables; they give the energy rule and the generator cooldowns.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const due = nextDue(player.merge, tables);
 * if (due !== undefined) wakeAt(due);
 * ```
 */
export function nextDue(_state: MergeState, _tables: Tables): number | undefined {
  throw new Error("not implemented");
}
