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
 * const reward = elementAt(rewards, stream.int(rewards.length));
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
 * const index = weightedIndex([{ weight: 1 }, { weight: 3 }], 2);
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
 * @example
 * ```ts
 * const drawn = ctx.require(modelPlugin).rng.peek("chest:42");
 * ```
 */
export function createRngApi(ctx: ModelCtx): RngApi {
  return {
    /**
     * Reads the committed state of one stream, for bookmarks, tools and tests.
     *
     * @param id - Stream id.
     * @returns The uint32 state of the stream, or `undefined` when it was never drawn.
     * @example
     * ```ts
     * app.model.rng.peek("chest:42");
     * ```
     */
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
 * @example
 * ```ts
 * const roll = createRngView(draft.rng).stream("chest:42").int(6);
 * ```
 */
export function createRngView(branch: RngState): RngView {
  /**
   * Draws the next uint32 of one stream and stores the advanced state on the branch.
   *
   * @param id - Stream id.
   * @returns The drawn uint32.
   * @example
   * ```ts
   * const value = draw("chest:42");
   * ```
   */
  const draw = (id: string): number => {
    const step = nextUint32(branch.streams[id] ?? hash32(branch.seed, id));

    branch.streams[id] = step.state;
    return step.value;
  };

  /**
   * Opens one stream. The first draw seeds it from the save's seed and the id, so opening a
   * stream without drawing leaves the branch untouched.
   *
   * @param id - Stream id. One id per source, for example `"chest:42"`.
   * @returns The stream of that id.
   * @example
   * ```ts
   * const stream = view.stream("chest:42");
   * ```
   */
  const stream = (id: string): RngStream => {
    /**
     * Draws an integer in `[0, maxExclusive)`.
     *
     * @param maxExclusive - Upper bound, excluded.
     * @returns The drawn integer.
     * @throws {Error} When the bound is not a positive integer.
     * @example
     * ```ts
     * const face = stream.int(6);
     * ```
     */
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

      /**
       * Draws an integer in `[min, maxInclusive]`.
       *
       * @param min - Lower bound, included.
       * @param maxInclusive - Upper bound, included.
       * @returns The drawn integer.
       * @throws {Error} When the span is empty.
       * @example
       * ```ts
       * const damage = stream.range(3, 5);
       * ```
       */
      range: (min: number, maxInclusive: number): number => min + int(maxInclusive - min + 1),

      /**
       * Picks one element of an array.
       *
       * @param items - The array to pick from.
       * @returns The picked element.
       * @throws {Error} When the array is empty or has holes.
       * @example
       * ```ts
       * const reward = stream.pick(["coin", "gem"]);
       * ```
       */
      pick: <Item>(items: readonly Item[]): Item => {
        if (items.length === 0) {
          throw new Error(
            `[game] The stream "${id}" was asked to pick from an empty array.\n  Pass at least one item.`
          );
        }

        return elementAt(items, int(items.length));
      },

      /**
       * Picks one entry of a table by its integer weight. Entries of weight zero never win.
       *
       * @param table - Entries with integer weights.
       * @returns The picked entry.
       * @throws {Error} When no entry has a positive weight.
       * @example
       * ```ts
       * const drop = stream.weighted([{ id: "coin", weight: 3 }, { id: "gem", weight: 1 }]);
       * ```
       */
      weighted: <Entry extends { weight: number }>(table: readonly Entry[]): Entry => {
        const total = table.reduce((sum, entry) => sum + entry.weight, 0);

        if (total < 1) {
          throw new Error(
            `[game] The stream "${id}" was asked to draw from a table without a positive weight.\n  Give at least one entry a weight above zero.`
          );
        }

        return elementAt(table, weightedIndex(table, int(total)));
      },

      /**
       * Draws a `numerator` in `denominator` chance.
       *
       * @param numerator - How many of the outcomes are a hit.
       * @param denominator - How many outcomes there are.
       * @returns True when the draw is a hit.
       * @throws {Error} When the denominator is not a positive integer.
       * @example
       * ```ts
       * const critical = stream.chance(1, 20);
       * ```
       */
      chance: (numerator: number, denominator: number): boolean => int(denominator) < numerator
    };
  };

  return { stream };
}
