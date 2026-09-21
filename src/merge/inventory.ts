/**
 * @file Merge kit — inventory rules skeleton. Fixed-size slots, `null` is an empty slot.
 */
import type { ItemId, MergeState, PlaceResult, TakeResult } from "./types";

/**
 * Moves an item from the board into the first free inventory slot. Returns
 * `{ ok: false, reason: "full" }` when no slot is free, or `{ ok: true, state, slot }`.
 *
 * @param _state - The rule state; it is not mutated.
 * @param _item - The id of the item to store.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const result = place(state, "i1");
 * if (result.ok) highlightSlot(result.slot);
 * ```
 */
export function place(_state: MergeState, _item: ItemId): PlaceResult {
  throw new Error("not implemented");
}

/**
 * Moves the item of an inventory slot back to a free cell of the board. Returns
 * `{ ok: false, reason }` with `"empty"` or `"boardFull"`, or `{ ok: true, state, item }`.
 *
 * @param _state - The rule state; it is not mutated.
 * @param _slot - The zero-based index of the inventory slot.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const result = take(state, 0);
 * if (result.ok) showItem(result.item);
 * ```
 */
export function take(_state: MergeState, _slot: number): TakeResult {
  throw new Error("not implemented");
}
