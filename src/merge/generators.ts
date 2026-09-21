/**
 * @file Merge kit — generator rules skeleton. Randomness arrives as the structural `Rng`.
 */
import type { GeneratorTable, MergeState, Rng, Tables, TapResult } from "./types";

/**
 * Picks one drop from a weighted list. Weights are integers, so the same `_rng` draws give the
 * same drop.
 *
 * @param _drops - The weighted drops of one generator.
 * @param _rng - The source of integers for the draw.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const drop = pickDrop(tables.generators.sawmill.drops, rng);
 * ```
 */
export function pickDrop(
  _drops: GeneratorTable[string]["drops"],
  _rng: Rng
): { chain: string; level: number } {
  throw new Error("not implemented");
}

/**
 * Taps a generator: spends energy and a charge and places the dropped item on a free cell, all
 * in one result. Returns `{ ok: false, reason }` with `"noEnergy"`, `"boardFull"` or `"cooling"`,
 * or `{ ok: true, state, item }`.
 *
 * @param _state - The rule state; it is not mutated.
 * @param _generatorId - The key of the generator in the generator table.
 * @param _now - The current moment in integer milliseconds, needed for the cooldown check.
 * @param _tables - The content tables.
 * @param _rng - The source of integers for the drop draw.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const result = tapGenerator(state, "sawmill", now, tables, rng);
 * if (!result.ok) showReason(result.reason);
 * ```
 */
export function tapGenerator(
  _state: MergeState,
  _generatorId: string,
  _now: number,
  _tables: Tables,
  _rng: Rng
): TapResult {
  throw new Error("not implemented");
}
