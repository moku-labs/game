/**
 * @file Merge kit — generator rules. Randomness arrives as the structural `Rng`.
 */
import { applyEnergyRegen } from "./elapse";
import { findFreeCell, withItem } from "./grid";
import type { GeneratorTable, Item, MergeState, Rng, Tables, TapResult } from "./types";

/**
 * Adds up the weights of a table.
 *
 * @param entries - The entries of a weighted table.
 * @param weightOf - Reads the integer weight of one entry.
 * @returns The total weight.
 * @example
 * ```ts
 * const total = totalWeight(drops, drop => drop.weight);
 * ```
 */
function totalWeight<T>(entries: readonly T[], weightOf: (entry: T) => number): number {
  let total = 0;

  for (const entry of entries) total += weightOf(entry);

  return total;
}

/**
 * Draws one entry out of a weighted table. Weights are integers, so one integer from `rng`
 * decides the draw and the same draws repeat for the same seed. An entry of weight zero is never
 * returned, because the walk passes it without widening the window.
 *
 * @param entries - The entries of the table, in their fixed order.
 * @param weightOf - Reads the integer weight of one entry.
 * @param rng - The source of integers for the draw.
 * @param what - The table's name, used in the error texts.
 * @returns The drawn entry.
 * @throws {Error} When the table is empty, its weights add up to zero, or the draw falls outside it.
 * @example
 * ```ts
 * const drop = drawWeighted(drops, drop => drop.weight, rng, "drop table");
 * ```
 */
export function drawWeighted<T>(
  entries: readonly T[],
  weightOf: (entry: T) => number,
  rng: Rng,
  what: string
): T {
  const total = totalWeight(entries, weightOf);

  if (total <= 0) {
    throw new Error(
      `[merge] The ${what} has no entry with a positive weight.\n  Give at least one entry of the ${what} a weight above zero.`
    );
  }

  const roll = rng.int(total);
  let walked = 0;

  for (const entry of entries) {
    walked += weightOf(entry);
    if (roll < walked) return entry;
  }

  throw new Error(
    `[merge] The draw ${roll} fell outside the ${what} of total weight ${total}.\n  Make rng.int(maxExclusive) return a value below maxExclusive.`
  );
}

/**
 * Reads one generator out of the generator table. A generator the table does not know is a
 * content error, not a player action, so it throws instead of returning a reason.
 *
 * @param tables - The content tables to read.
 * @param generatorId - The key of the generator.
 * @returns The cell, cost, cooldown, charges and drops of that generator.
 * @throws {Error} When the generator is not in the generator table.
 * @example
 * ```ts
 * const spec = generatorSpec(tables, "sawmill");
 * ```
 */
function generatorSpec(tables: Tables, generatorId: string): GeneratorTable[string] {
  const spec = tables.generators[generatorId];

  if (spec === undefined) {
    throw new Error(
      `[merge] The generator "${generatorId}" is not in the generator table.\n  Add it to tables.generators or fix the generator id.`
    );
  }

  // A content error, like the one above: without charges to refill, the count would go negative.
  if (spec.maxCharges <= 0) {
    throw new Error(
      `[merge] The generator "${generatorId}" has no positive maxCharges.\n  Set maxCharges to 1 or more in tables.generators.`
    );
  }

  return spec;
}

/**
 * Reads the saved charges and wake-up moment of one generator.
 *
 * @param state - The rule state to read.
 * @param generatorId - The key of the generator.
 * @returns The saved charges and wake-up moment.
 * @throws {Error} When the save holds no entry for that generator.
 * @example
 * ```ts
 * const stored = storedGenerator(state, "sawmill");
 * ```
 */
function storedGenerator(state: MergeState, generatorId: string): MergeState["generators"][string] {
  const stored = state.generators[generatorId];

  if (stored === undefined) {
    throw new Error(
      `[merge] The generator "${generatorId}" has no entry in the saved generators.\n  Add it to state.generators before tapping it.`
    );
  }

  return stored;
}

/**
 * Picks one drop from a weighted list. Weights are integers, so the same draws from `rng` give
 * the same drop; an entry of weight zero is never picked.
 *
 * @param drops - The weighted drops of one generator.
 * @param rng - The source of integers for the draw.
 * @returns The chain and level of the drawn item.
 * @throws {Error} When the table is empty, its weights add up to zero, or the draw falls outside it.
 * @example
 * ```ts
 * const drop = pickDrop(tables.generators.sawmill.drops, rng);
 * ```
 */
export function pickDrop(
  drops: GeneratorTable[string]["drops"],
  rng: Rng
): { chain: string; level: number } {
  const drop = drawWeighted(drops, candidate => candidate.weight, rng, "drop table");

  return { chain: drop.chain, level: drop.level };
}

/**
 * Taps a generator: it spends energy and one charge and places the dropped item on a free cell,
 * all in one result. The three refusals are checked in the order a player meets them — a spent
 * generator is `"cooling"` until its cooldown ends, then an empty bar is `"noEnergy"`, then a
 * board with no room is `"boardFull"`. Energy earned while the game was closed is collected
 * before the cost is taken, so a tap never throws away a regenerated point. Spending the last
 * charge starts the cooldown; the drop lands on the ring nearest the generator's own cell.
 *
 * @param state - The rule state; it is not mutated.
 * @param generatorId - The key of the generator in the generator table.
 * @param now - The current moment in integer milliseconds, needed for the cooldown check.
 * @param tables - The content tables.
 * @param rng - The source of integers for the drop draw.
 * @returns `{ ok: false, reason }`, or the new state and the item that was placed.
 * @throws {Error} When the generator is unknown, the save holds no entry for it, or its drop table is empty.
 * @example
 * ```ts
 * const result = tapGenerator(state, "sawmill", now, tables, rng);
 * if (!result.ok) showReason(result.reason);
 * ```
 */
export function tapGenerator(
  state: MergeState,
  generatorId: string,
  now: number,
  tables: Tables,
  rng: Rng
): TapResult {
  const spec = generatorSpec(tables, generatorId);
  const stored = storedGenerator(state, generatorId);

  // A spent generator stays shut until its cooldown ends, then it comes back full.
  if (stored.charges === 0 && now < stored.readyAt) return { ok: false, reason: "cooling" };
  const refilled = stored.charges === 0 ? { ...stored, charges: spec.maxCharges } : stored;

  // Energy earned while away is collected first, so the tap spends from the real bar.
  const energy = applyEnergyRegen(state.energy, now, tables.energy);
  if (energy.value < spec.energyCost) return { ok: false, reason: "noEnergy" };

  const cell = findFreeCell(state.board, spec.cell);
  if (cell === undefined) return { ok: false, reason: "boardFull" };

  const drop = pickDrop(spec.drops, rng);
  const item: Item = { id: `i${state.nextItemId}`, chain: drop.chain, level: drop.level, cell };
  const charges = refilled.charges - 1;

  return {
    ok: true,
    state: {
      ...state,
      board: withItem(state.board, item),
      energy: { ...energy, value: energy.value - spec.energyCost },
      generators: {
        ...state.generators,
        [generatorId]: {
          charges,
          readyAt: charges === 0 ? now + spec.cooldownMs : refilled.readyAt
        }
      },
      nextItemId: state.nextItemId + 1
    },
    item
  };
}
