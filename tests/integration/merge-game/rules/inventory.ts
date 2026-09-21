/**
 * @file Merge kit — inventory rules. Fixed-size slots, `null` is an empty slot.
 */
import { findFreeCell, itemById, withItem, withoutItem } from "./grid";
import type { Item, ItemId, MergeState, PlaceResult, TakeResult } from "./types";

/**
 * Returns the inventory with one slot replaced. The input list is not mutated.
 *
 * @param inventory - The slots to copy from.
 * @param slot - The zero-based position to replace.
 * @param content - The item that takes that slot, or `null` to empty it.
 * @returns A new list of slots.
 * @example
 * ```ts
 * const inventory = replaceSlot(state.inventory, 0, { ...item, cell: "" });
 * ```
 */
function replaceSlot(
  inventory: readonly (Item | null)[],
  slot: number,
  content: Item | null
): (Item | null)[] {
  return inventory.map((entry, index) => (index === slot ? content : entry));
}

/**
 * Moves an item from the board into the first free inventory slot. The item keeps its id and
 * its `cell` becomes the empty string, because a stored item stands nowhere on the board.
 *
 * @param state - The rule state; it is not mutated.
 * @param item - The id of the item to store.
 * @returns `{ ok: false, reason: "missing" }` when the item is not on the board, `"full"` when no
 *   slot is free, or the new state and the slot used.
 * @example
 * ```ts
 * const result = place(state, "i1");
 * if (result.ok) highlightSlot(result.slot);
 * ```
 */
export function place(state: MergeState, item: ItemId): PlaceResult {
  const found = itemById(state.board, item);

  // An expected failure, like `sell`: a double tap places the same item twice.
  if (found === undefined) return { ok: false, reason: "missing" };

  // eslint-disable-next-line unicorn/no-null -- an empty inventory slot is null in the save format
  const slot = state.inventory.indexOf(null);
  if (slot === -1) return { ok: false, reason: "full" };

  const stored: Item = { ...found, cell: "" };

  return {
    ok: true,
    state: {
      ...state,
      board: withoutItem(state.board, found.id),
      inventory: replaceSlot(state.inventory, slot, stored)
    },
    slot
  };
}

/**
 * Moves the item of an inventory slot back onto the board, into the first free cell in row-major
 * order. A slot outside the inventory reads as empty.
 *
 * @param state - The rule state; it is not mutated.
 * @param slot - The zero-based index of the inventory slot.
 * @returns `{ ok: false, reason }` with `"empty"` or `"boardFull"`, or the new state and the item.
 * @example
 * ```ts
 * const result = take(state, 0);
 * if (result.ok) showItem(result.item);
 * ```
 */
export function take(state: MergeState, slot: number): TakeResult {
  const stored = state.inventory[slot];
  if (stored === undefined || stored === null) return { ok: false, reason: "empty" };

  const cell = findFreeCell(state.board);
  if (cell === undefined) return { ok: false, reason: "boardFull" };

  const item: Item = { ...stored, cell };

  return {
    ok: true,
    state: {
      ...state,
      board: withItem(state.board, item),
      // eslint-disable-next-line unicorn/no-null -- an empty inventory slot is null in the save format
      inventory: replaceSlot(state.inventory, slot, null)
    },
    item
  };
}
