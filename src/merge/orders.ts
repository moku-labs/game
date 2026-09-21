/**
 * @file Merge kit — order rules skeleton. Value is granted where it is paid.
 */
import type { GiveInput, GiveResult, ItemId, MergeState, Rng, Tables } from "./types";

/**
 * Tells whether an item fits a need of an order that is not given yet.
 *
 * @param _state - The rule state to read.
 * @param _item - The id of the item to give.
 * @param _order - The id of the order slot.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * if (isLegalOrderMatch(state, "i1", 0)) highlightOrder(0);
 * ```
 */
export function isLegalOrderMatch(_state: MergeState, _item: ItemId, _order: number): boolean {
  throw new Error("not implemented");
}

/**
 * Gives an item to an order. When the order completes, the reward is already inside the
 * returned wallet and the next order is drawn from `_rng`. Returns `{ ok: false, reason }` with
 * `"missing"` or `"no-match"`, or `{ ok: true, state, completed, rewardId? }`.
 *
 * @param _state - The rule state; it is not mutated.
 * @param _input - The item to give and the order slot that takes it.
 * @param _tables - The content tables; the order table gives rewards and draw weights.
 * @param _rng - The source of integers for the next order draw.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const result = giveToOrder(state, { item: "i1", order: 0 }, tables, rng);
 * if (result.ok && result.completed) showReward(result.rewardId);
 * ```
 */
export function giveToOrder(
  _state: MergeState,
  _input: GiveInput,
  _tables: Tables,
  _rng: Rng
): GiveResult {
  throw new Error("not implemented");
}
