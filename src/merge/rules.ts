/**
 * @file Merge kit — merge and sell rules skeleton. Pure functions, inputs are never mutated.
 */
import type { CellId, ItemId, MergeResult, MergeState, SellResult, Tables } from "./types";

/**
 * Tells whether two cells can be merged: both hold items of the same chain and the same level,
 * and that level is below the chain's top.
 *
 * @param _state - The rule state to read.
 * @param _from - The cell of the dragged item.
 * @param _to - The cell of the target item.
 * @param _tables - The content tables; the chain table gives the top level.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * if (isLegalMerge(state, "c0_0", "c1_0", tables)) highlight("c1_0");
 * ```
 */
export function isLegalMerge(
  _state: MergeState,
  _from: CellId,
  _to: CellId,
  _tables: Tables
): boolean {
  throw new Error("not implemented");
}

/**
 * Merges the item on `_from` into the item on `_to`. Returns `{ legal: false, reason }` or
 * `{ legal: true, state, item }` with a new state and the item of the next level.
 *
 * @param _state - The rule state; it is not mutated.
 * @param _from - The cell of the dragged item.
 * @param _to - The cell of the target item; the new item stands here.
 * @param _tables - The content tables; the chain table gives the top level.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const result = merge(state, "c0_0", "c1_0", tables);
 * if (result.legal) save(result.state);
 * ```
 */
export function merge(
  _state: MergeState,
  _from: CellId,
  _to: CellId,
  _tables: Tables
): MergeResult {
  throw new Error("not implemented");
}

/**
 * Sells one item for the price of its chain and level. The coins are already inside the
 * returned wallet. Returns `{ ok: false, reason: "missing" }` when the item does not exist.
 *
 * @param _state - The rule state; it is not mutated.
 * @param _item - The id of the item to sell.
 * @param _tables - The content tables; the chain table gives the sell price per level.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const result = sell(state, "i1", tables);
 * if (result.ok) showCoins(result.coins);
 * ```
 */
export function sell(_state: MergeState, _item: ItemId, _tables: Tables): SellResult {
  throw new Error("not implemented");
}
