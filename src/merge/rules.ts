/**
 * @file Merge kit — merge and sell rules. Pure functions, inputs are never mutated.
 */
import { itemAt, itemById, replaceItem, withoutItem } from "./grid";
import type {
  CellId,
  ChainTable,
  Item,
  ItemId,
  MergeResult,
  MergeState,
  SellResult,
  Tables,
  Wallet
} from "./types";

/**
 * Why a merge is rejected. The same four reasons `merge` returns.
 *
 * @example
 * ```ts
 * const reason: MergeReason = "different";
 * ```
 */
type MergeReason = Extract<MergeResult, { legal: false }>["reason"];

/**
 * The outcome of checking a merge: either the reason it is rejected, or the two items it joins.
 *
 * @example
 * ```ts
 * const check: MergeCheck = { reason: "top" };
 * ```
 */
type MergeCheck = { reason: MergeReason } | { source: Item; target: Item };

/**
 * Reads one chain out of the chain table. A chain the table does not know is a content error,
 * not a player action, so it throws instead of returning a reason.
 *
 * @param tables - The content tables to read.
 * @param chain - The chain name carried by an item.
 * @returns The top level and the sell prices of that chain.
 * @throws {Error} When the chain is not in the chain table.
 * @example
 * ```ts
 * const chain = chainOf(tables, "wood");
 * ```
 */
function chainOf(tables: Tables, chain: string): ChainTable[string] {
  const entry = tables.chains[chain];

  if (entry === undefined) {
    throw new Error(
      `[merge] The chain "${chain}" is not in the chain table.\n  Add it to tables.chains or fix the item's chain.`
    );
  }

  return entry;
}

/**
 * Checks one merge and reports either the reason it is rejected or the two items it joins.
 * `merge` and `isLegalMerge` both read this, so the view highlights exactly what the rule allows.
 *
 * @param state - The rule state to read.
 * @param from - The cell of the dragged item.
 * @param to - The cell of the target item.
 * @param tables - The content tables; the chain table gives the top level.
 * @returns The rejection reason, or the source and target items.
 * @throws {Error} When an item carries a chain the chain table does not know.
 * @example
 * ```ts
 * const check = checkMerge(state, "c0_0", "c1_0", tables);
 * ```
 */
function checkMerge(state: MergeState, from: CellId, to: CellId, tables: Tables): MergeCheck {
  if (from === to) return { reason: "same-cell" };

  const source = itemAt(state.board, from);
  const target = itemAt(state.board, to);
  if (source === undefined || target === undefined) return { reason: "empty" };

  if (source.chain !== target.chain || source.level !== target.level)
    return { reason: "different" };

  // A chain stops at its top level: two top items stay two top items.
  if (target.level >= chainOf(tables, target.chain).top) return { reason: "top" };

  return { source, target };
}

/**
 * Adds counters to a wallet and returns a new wallet. A counter the wallet does not carry yet
 * starts at zero. The input wallet is not mutated.
 *
 * @param wallet - The wallet to copy from.
 * @param gains - The counters to add, for example `{ coins: 25 }`.
 * @returns A new wallet with the gains added.
 * @example
 * ```ts
 * const wallet = addToWallet(state.wallet, { coins: 25 });
 * ```
 */
export function addToWallet(wallet: Wallet, gains: Wallet): Wallet {
  const next: Wallet = { ...wallet };

  for (const [name, amount] of Object.entries(gains)) next[name] = (next[name] ?? 0) + amount;

  return next;
}

/**
 * Tells whether two cells can be merged: both hold items of the same chain and the same level,
 * the cells differ, and that level is below the chain's top. The view calls it to highlight a
 * drop target, so it answers exactly what `merge` would accept.
 *
 * @param state - The rule state to read.
 * @param from - The cell of the dragged item.
 * @param to - The cell of the target item.
 * @param tables - The content tables; the chain table gives the top level.
 * @returns True when `merge` would accept this pair.
 * @throws {Error} When an item carries a chain the chain table does not know.
 * @example
 * ```ts
 * if (isLegalMerge(state, "c0_0", "c1_0", tables)) highlight("c1_0");
 * ```
 */
export function isLegalMerge(state: MergeState, from: CellId, to: CellId, tables: Tables): boolean {
  return !("reason" in checkMerge(state, from, to, tables));
}

/**
 * Merges the item on `from` into the item on `to`. The target rises by one level and keeps its
 * own id and cell, the dragged item disappears, and no new id is minted. Returns
 * `{ legal: false, reason }` or `{ legal: true, state, item }`.
 *
 * @param state - The rule state; it is not mutated.
 * @param from - The cell of the dragged item.
 * @param to - The cell of the target item; the risen item stands here.
 * @param tables - The content tables; the chain table gives the top level.
 * @returns The rejection reason, or the new state and the item of the next level.
 * @throws {Error} When an item carries a chain the chain table does not know.
 * @example
 * ```ts
 * const result = merge(state, "c0_0", "c1_0", tables);
 * if (result.legal) save(result.state);
 * ```
 */
export function merge(state: MergeState, from: CellId, to: CellId, tables: Tables): MergeResult {
  const check = checkMerge(state, from, to, tables);
  if ("reason" in check) return { legal: false, reason: check.reason };

  // The target keeps its id, so views and animations follow one continuous item.
  const risen: Item = { ...check.target, level: check.target.level + 1 };
  const board = replaceItem(withoutItem(state.board, check.source.id), risen);

  return { legal: true, state: { ...state, board }, item: risen };
}

/**
 * Sells one item off the board for the price its chain pays at that level. Levels are one-based,
 * so the price is `sellPrice[level - 1]`; a level the chain has no price for pays nothing. The
 * coins are already inside the returned wallet, because value is granted where it is paid.
 *
 * @param state - The rule state; it is not mutated.
 * @param item - The id of the item to sell; only the board is searched.
 * @param tables - The content tables; the chain table gives the sell price per level.
 * @returns `{ ok: false, reason: "missing" }`, or the new state and the coins paid.
 * @throws {Error} When the item carries a chain the chain table does not know.
 * @example
 * ```ts
 * const result = sell(state, "i1", tables);
 * if (result.ok) showCoins(result.coins);
 * ```
 */
export function sell(state: MergeState, item: ItemId, tables: Tables): SellResult {
  const found = itemById(state.board, item);
  if (found === undefined) return { ok: false, reason: "missing" };

  const coins = chainOf(tables, found.chain).sellPrice[found.level - 1] ?? 0;

  return {
    ok: true,
    state: {
      ...state,
      board: withoutItem(state.board, found.id),
      wallet: addToWallet(state.wallet, { coins })
    },
    coins
  };
}
