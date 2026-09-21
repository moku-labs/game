/**
 * @file model/rng — API factory. The module keeps no state: every stream lives in the save document.
 */
import type { ModelCtx } from "../types";
import { hash32, nextUint32 } from "./prng";
import type { RngApi, RngState, RngStream, RngView } from "./types";

/** Size of the uint32 space a draw is projected from. */
const uint32Space = 2 ** 32;

/**
 * Reads an element the caller has already drawn an index for.
 * A hole in the array would silently hand `undefined` to a node, so it is an error.
 *
 * @param items - The array drawn from.
 * @param index - Index inside the array.
 * @returns The element at `index`.
 * @throws {Error} When the slot is empty.
 * @example
 * ```ts
 * elementAt(["coin", "gem"], 1); // "gem"
 * ```
 */
function elementAt<Item>(items: readonly Item[], index: number): Item {
  const item = items[index];

  if (item === undefined) {
    throw new Error("[game] The drawn slot of the array is empty.\n  Draw from a dense array.");
  }

  return item;
}

/**
 * Picks the index of a weighted table from one roll.
 *
 * @param table - Entries with integer weights.
 * @param roll - A value in `[0, total weight)`.
 * @returns Index of the entry the roll lands on.
 * @example
 * ```ts
 * weightedIndex([{ weight: 1 }, { weight: 3 }], 0); // 0
 * weightedIndex([{ weight: 1 }, { weight: 3 }], 2); // 1
 * ```
 */
function weightedIndex(table: readonly { weight: number }[], roll: number): number {
  let remaining = roll;

  for (const [index, entry] of table.entries()) {
    remaining -= entry.weight;
    if (remaining < 0) return index;
  }

  // Unreachable: `roll` is below the total weight.
  return table.length - 1;
}

/**
 * Creates the rng API: inspection of stream state in the committed document.
 * Draws never happen here; they happen on the draft branch of an open transaction.
 *
 * @param ctx - Domain context of the model plugin.
 * @returns The `rng` half of `app.model`.
 */
export function createRngApi(ctx: ModelCtx): RngApi {
  return {
    peek: (id: string): number | undefined => ctx.state.store.doc.rng.streams[id]
  };
}

/**
 * Creates an rng view over a plain rng branch, draft or frozen.
 * Every draw advances `branch.streams[id]`, so draws inside a transaction commit with it and
 * draws inside a discarded transaction are forgotten with it.
 *
 * @param branch - Rng branch of a save document.
 * @returns A view that hands out one stream per source id.
 */
export function createRngView(branch: RngState): RngView {
  /**
   * Draws the next uint32 of one stream and stores the advanced state on the branch.
   *
   * @param id - Stream id.
   * @returns The drawn uint32.
   */
  const draw = (id: string): number => {
    const step = nextUint32(branch.streams[id] ?? hash32(branch.seed, id));

    branch.streams[id] = step.state;
    return step.value;
  };

  const stream = (id: string): RngStream => {
    const int = (maxExclusive: number): number => {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
        throw new Error(
          `[game] The stream "${id}" was asked for an integer below ${maxExclusive}.\n  Pass a positive whole number as the bound.`
        );
      }

      return Math.floor((draw(id) / uint32Space) * maxExclusive);
    };

    return {
      int,

      range: (min: number, maxInclusive: number): number => min + int(maxInclusive - min + 1),

      pick: <Item>(items: readonly Item[]): Item => {
        if (items.length === 0) {
          throw new Error(
            `[game] The stream "${id}" was asked to pick from an empty array.\n  Pass at least one item.`
          );
        }

        return elementAt(items, int(items.length));
      },

      weighted: <Entry extends { weight: number }>(table: readonly Entry[]): Entry => {
        const total = table.reduce((sum, entry) => sum + entry.weight, 0);

        if (total < 1) {
          throw new Error(
            `[game] The stream "${id}" was asked to draw from a table without a positive weight.\n  Give at least one entry a weight above zero.`
          );
        }

        return elementAt(table, weightedIndex(table, int(total)));
      },

      chance: (numerator: number, denominator: number): boolean => int(denominator) < numerator
    };
  };

  return { stream };
}
