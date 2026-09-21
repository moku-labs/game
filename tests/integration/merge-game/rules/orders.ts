/**
 * @file Merge kit — order rules. Value is granted where it is paid.
 */
import { drawWeighted } from "./generators";
import { itemById, withoutItem } from "./grid";
import { addToWallet } from "./rules";
import type {
  GiveInput,
  GiveResult,
  Item,
  ItemId,
  MergeState,
  Order,
  Rng,
  Tables,
  Wallet
} from "./types";

/**
 * One item matched to one open need of one order slot.
 *
 * @example
 * ```ts
 * const match: OrderMatch = { slot: 0, order, item, need: 1 };
 * ```
 */
type OrderMatch = { slot: number; order: Order; item: Item; need: number };

/**
 * The outcome of matching an item to an order: either the reason it is refused, or the match.
 *
 * @example
 * ```ts
 * const check: MatchCheck = { reason: "no-match" };
 * ```
 */
type MatchCheck = { reason: "missing" | "no-match" } | OrderMatch;

/**
 * Matches an item on the board to the first open need of an order slot. Both `isLegalOrderMatch`
 * and `giveToOrder` read this, so the view highlights exactly what the rule accepts.
 *
 * @param state - The rule state to read.
 * @param item - The id of the item to give.
 * @param order - The id of the order that holds the slot.
 * @returns The refusal reason, or the slot, order, item and need index that match.
 * @example
 * ```ts
 * const check = checkOrderMatch(state, "i1", 7);
 * ```
 */
function checkOrderMatch(state: MergeState, item: ItemId, order: number): MatchCheck {
  const found = itemById(state.board, item);
  const slot = state.orders.findIndex(candidate => candidate.id === order);
  const target = state.orders[slot];

  if (found === undefined || target === undefined) return { reason: "missing" };

  const need = target.needs.findIndex(
    (candidate, index) =>
      !target.given.includes(index) &&
      candidate.chain === found.chain &&
      candidate.level === found.level
  );

  if (need === -1) return { reason: "no-match" };

  return { slot, order: target, item: found, need };
}

/**
 * Reads the reward an order pays out of the order table.
 *
 * @param tables - The content tables to read.
 * @param rewardId - The reward the finished order names.
 * @returns The counters the reward grants.
 * @throws {Error} When no entry of the order table carries that reward.
 * @example
 * ```ts
 * const reward = orderReward(tables, "coins-small");
 * ```
 */
function orderReward(tables: Tables, rewardId: string): Wallet {
  const entry = tables.orders.find(candidate => candidate.rewardId === rewardId);

  if (entry === undefined) {
    throw new Error(
      `[merge] The reward "${rewardId}" is not in the order table.\n  Add an entry with this rewardId to tables.orders.`
    );
  }

  return entry.reward;
}

/**
 * Draws the order that takes over a freed slot. Its id is one above the highest id in play, so
 * two slots never carry the same id, and its needs are copied out of the table.
 *
 * @param orders - The order slots as they stand before the draw.
 * @param tables - The content tables; the order table gives the needs, rewards and weights.
 * @param rng - The source of integers for the draw.
 * @returns A fresh order with an empty `given` list.
 * @throws {Error} When the order table is empty or its weights add up to zero.
 * @example
 * ```ts
 * const order = drawOrder(state.orders, tables, rng);
 * ```
 */
function drawOrder(orders: readonly Order[], tables: Tables, rng: Rng): Order {
  const entry = drawWeighted(tables.orders, candidate => candidate.weight, rng, "order table");
  const highestId = Math.max(...orders.map(order => order.id));

  return {
    id: highestId + 1,
    needs: entry.needs.map(need => ({ ...need })),
    given: [],
    rewardId: entry.rewardId
  };
}

/**
 * Returns the order slots with one slot replaced. The input list is not mutated.
 *
 * @param orders - The order slots to copy from.
 * @param slot - The zero-based position to replace.
 * @param order - The order that takes that position.
 * @returns A new list of order slots.
 * @example
 * ```ts
 * const orders = replaceOrder(state.orders, 0, { ...order, given: [0] });
 * ```
 */
function replaceOrder(orders: readonly Order[], slot: number, order: Order): Order[] {
  return orders.map((candidate, index) => (index === slot ? order : candidate));
}

/**
 * Tells whether an item on the board fits a need of an order that is not given yet. The view
 * calls it to highlight an order as a drop target, so it answers exactly what `giveToOrder`
 * accepts.
 *
 * @param state - The rule state to read.
 * @param item - The id of the item to give.
 * @param order - The id of the order that holds the slot.
 * @returns True when `giveToOrder` would accept this pair.
 * @example
 * ```ts
 * if (isLegalOrderMatch(state, "i1", 7)) highlightOrder(7);
 * ```
 */
export function isLegalOrderMatch(state: MergeState, item: ItemId, order: number): boolean {
  return !("reason" in checkOrderMatch(state, item, order));
}

/**
 * Gives an item to an order. The item leaves the board and its need is marked in `given`. When
 * that was the last open need the order is complete: its reward is already inside the returned
 * wallet, because value is granted where it is paid, its `rewardId` comes back so the view can
 * show what was won, and the slot takes a freshly drawn order with a new id and no needs given.
 *
 * @param state - The rule state; it is not mutated.
 * @param input - The item to give and the id of the order that takes it.
 * @param tables - The content tables; the order table gives rewards and draw weights.
 * @param rng - The source of integers for the next order draw.
 * @returns `{ ok: false, reason }` with `"missing"` or `"no-match"`, or the new state, whether the
 * order completed, and the reward it paid.
 * @throws {Error} When a finished order names a reward the order table does not carry, or the
 * order table cannot be drawn from.
 * @example
 * ```ts
 * const result = giveToOrder(state, { item: "i1", order: 7 }, tables, rng);
 * if (result.ok && result.completed) showReward(result.rewardId);
 * ```
 */
export function giveToOrder(
  state: MergeState,
  input: GiveInput,
  tables: Tables,
  rng: Rng
): GiveResult {
  const check = checkOrderMatch(state, input.item, input.order);
  if ("reason" in check) return { ok: false, reason: check.reason };

  const given = [...check.order.given, check.need];
  const board = withoutItem(state.board, check.item.id);

  // Still open: only the need is marked, nothing is paid out yet.
  if (given.length < check.order.needs.length) {
    const orders = replaceOrder(state.orders, check.slot, { ...check.order, given });

    return { ok: true, state: { ...state, board, orders }, completed: false };
  }

  // Complete: the reward is paid here and a new order moves into the freed slot.
  const wallet = addToWallet(state.wallet, orderReward(tables, check.order.rewardId));
  const orders = replaceOrder(state.orders, check.slot, drawOrder(state.orders, tables, rng));

  return {
    ok: true,
    state: { ...state, board, orders, wallet },
    completed: true,
    rewardId: check.order.rewardId
  };
}
