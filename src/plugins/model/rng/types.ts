/**
 * @file model/rng — type definitions.
 */

/**
 * Persisted randomness: one uint32 per stream id.
 *
 * @example
 * ```ts
 * // Seed 42, one draw from the stream "chest:42".
 * const rng: RngState = { seed: 42, streams: { "chest:42": 22541618 } };
 * ```
 */
export type RngState = { seed: number; streams: Record<string, number> };

/**
 * One deterministic stream. Integers only, so every engine produces the same numbers.
 *
 * @example
 * ```ts
 * // Inside a node the rng view comes with the context.
 * export const roll = defineNode({
 *   outcomes: { done: type() },
 *   run: ({ player, rng, out }) => {
 *     player.coins += rng.stream("dice").range(1, 6); // 4: first draw of a save with seed 42
 *     return out.done();
 *   }
 * });
 * ```
 */
export type RngStream = {
  /**
   * Draws an integer in `[0, maxExclusive)`.
   *
   * @param maxExclusive - Upper bound, excluded.
   * @returns The drawn integer.
   * @throws {Error} When the bound is not a positive integer.
   * @example
   * ```ts
   * // Which of the six board columns gets the new tile.
   * const column = rng.stream("spawn").int(6); // 0 to 5
   * ```
   */
  int(maxExclusive: number): number;

  /**
   * Draws an integer in `[min, maxInclusive]`.
   *
   * @param min - Lower bound, included.
   * @param maxInclusive - Upper bound, included.
   * @returns The drawn integer.
   * @throws {Error} When the span is empty.
   * @example
   * ```ts
   * // A die.
   * player.lastRoll = rng.stream("dice").range(1, 6); // 4: first draw of a save with seed 42
   * ```
   */
  range(min: number, maxInclusive: number): number;

  /**
   * Picks one element of an array.
   *
   * @param items - The array to pick from.
   * @returns The picked element.
   * @throws {Error} When the array is empty or has holes.
   * @example
   * ```ts
   * // The reward of chest 42.
   * rng.stream("chest:42").pick(["coin", "gem", "key"]); // "gem": first draw, seed 42
   * ```
   */
  pick<Item>(items: readonly Item[]): Item;

  /**
   * Picks one entry of a table by its integer weight. Entries of weight zero never win.
   *
   * @param table - Entries with integer weights.
   * @returns The picked entry.
   * @throws {Error} When no entry has a positive weight.
   * @example
   * ```ts
   * // A coin drops three times as often as a gem.
   * const drop = rng.stream("drop").weighted([
   *   { id: "coin", weight: 3 },
   *   { id: "gem", weight: 1 }
   * ]); // { id: "gem", weight: 1 }: first draw, seed 42
   * ```
   */
  weighted<Entry extends { weight: number }>(table: readonly Entry[]): Entry;

  /**
   * Draws a `numerator` in `denominator` chance.
   *
   * @param numerator - How many of the outcomes are a hit.
   * @param denominator - How many outcomes there are.
   * @returns True when the draw is a hit.
   * @throws {Error} When the denominator is not a positive integer.
   * @example
   * ```ts
   * // One merge in twenty gives a bonus tile.
   * const bonus = rng.stream("bonus").chance(1, 20);
   * ```
   */
  chance(numerator: number, denominator: number): boolean;
};

/**
 * View over an rng branch, draft or frozen: `rng` of a node context. Every draw advances
 * `streams[id]` of the branch, so draws inside a transaction commit with it and draws inside a
 * discarded transaction are forgotten with it.
 */
export type RngView = {
  /**
   * Opens one stream. The first draw seeds it from the save's seed and the id, so opening a
   * stream without drawing leaves the branch untouched.
   *
   * @param id - Stream id. One id per source, for example `"chest:42"`.
   * @returns The stream of that id.
   * @example
   * ```ts
   * // One id per source: a kill of the app before the rest node cannot re-roll chest 42.
   * const chest = rng.stream("chest:42");
   * chest.int(6); // 2: first draw of a save with seed 42
   * chest.int(6); // 0
   * ```
   */
  stream(id: string): RngStream;
};

/**
 * Factory injected into the store module.
 */
export type CreateRngView = (branch: RngState) => RngView;

/**
 * rng module API, `app.model.rng`: inspection of stream state in the committed document. Draws
 * never happen here; they happen on the `rng` view of a node context.
 */
export type RngApi = {
  /**
   * Reads the committed state of one stream, for bookmarks, tools and tests. It never draws.
   *
   * @param id - Stream id.
   * @returns The uint32 state of the stream, or `undefined` when it was never drawn.
   * @example
   * ```ts
   * // A test checks that one roll drew from the dice stream. The save has seed 42.
   * app.model.rng.peek("dice"); // undefined: never drawn
   * await game.walk([{ at: "home", intent: "roll" }]);
   * app.model.rng.peek("dice"); // 1175946015
   * ```
   */
  peek(id: string): number | undefined;
};
