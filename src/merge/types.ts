/**
 * @file Merge kit — type definitions. No engine import.
 */

/**
 * Cell address in the form `c<col>_<row>`, zero-based.
 *
 * @example
 * ```ts
 * const cell: CellId = "c2_0";
 * ```
 */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- a named address reads better than a bare string in every signature
export type CellId = string;

/**
 * Unique item id inside one save.
 *
 * @example
 * ```ts
 * const id: ItemId = "i17";
 * ```
 */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- a named id reads better than a bare string in every signature
export type ItemId = string;

/**
 * One item on the board or in the inventory. `level` is an integer.
 *
 * @example
 * ```ts
 * const item: Item = { id: "i1", chain: "wood", level: 1, cell: "c0_0" };
 * ```
 */
export type Item = { id: ItemId; chain: string; level: number; cell: CellId };

/**
 * The board: its size in cells and the items on it.
 *
 * @example
 * ```ts
 * const board: Board = { cols: 7, rows: 9, items: [] };
 * ```
 */
export type Board = { cols: number; rows: number; items: Item[] };

/**
 * Coins and other counters by name. Every value is an integer.
 *
 * @example
 * ```ts
 * const wallet: Wallet = { coins: 120, gems: 3 };
 * ```
 */
export type Wallet = Record<string, number>;

/**
 * One order slot: what it needs, which needs are already given, and the reward it grants.
 *
 * @example
 * ```ts
 * const order: Order = { id: 0, needs: [{ chain: "wood", level: 3 }], given: [], rewardId: "coins-small" };
 * ```
 */
export type Order = {
  id: number;
  needs: { chain: string; level: number }[];
  given: number[];
  rewardId: string;
};

/**
 * Whole rule state, a plain part of the player's save. The inventory has a fixed number of
 * slots; `null` is an empty slot. Moments (`countedAt`, `readyAt`) are integer milliseconds.
 *
 * @example
 * ```ts
 * const state: MergeState = {
 *   board: { cols: 7, rows: 9, items: [] },
 *   energy: { value: 100, max: 100, countedAt: 0 },
 *   generators: { sawmill: { readyAt: 0, charges: 5 } },
 *   orders: [],
 *   wallet: { coins: 0 },
 *   inventory: [null, null, null],
 *   nextItemId: 1
 * };
 * ```
 */
export type MergeState = {
  board: Board;
  energy: { value: number; max: number; countedAt: number };
  generators: Record<string, { readyAt: number; charges: number }>;
  orders: Order[];
  wallet: Wallet;
  inventory: (Item | null)[];
  nextItemId: number;
};

/**
 * Item chains: top level and sell price per level.
 *
 * @example
 * ```ts
 * const chains: ChainTable = { wood: { top: 5, sellPrice: [0, 1, 2, 4, 8, 16] } };
 * ```
 */
export type ChainTable = Record<string, { top: number; sellPrice: number[] }>;

/**
 * Generators: place, cost, cooldown, charges and weighted drops. Weights are integers.
 *
 * @example
 * ```ts
 * const generators: GeneratorTable = {
 *   sawmill: {
 *     cell: "c3_4",
 *     energyCost: 1,
 *     cooldownMs: 60_000,
 *     maxCharges: 5,
 *     drops: [{ chain: "wood", level: 1, weight: 9 }]
 *   }
 * };
 * ```
 */
export type GeneratorTable = Record<
  string,
  {
    cell: CellId;
    energyCost: number;
    cooldownMs: number;
    maxCharges: number;
    drops: { chain: string; level: number; weight: number }[];
  }
>;

/**
 * Order pool: what an order needs, what it grants, and its draw weight.
 *
 * @example
 * ```ts
 * const orders: OrderTable = [
 *   { needs: [{ chain: "wood", level: 3 }], rewardId: "coins-small", reward: { coins: 25 }, weight: 4 }
 * ];
 * ```
 */
export type OrderTable = {
  needs: { chain: string; level: number }[];
  rewardId: string;
  reward: Wallet;
  weight: number;
}[];

/**
 * Energy regeneration rule: one point every `regenMs`, up to `max`.
 *
 * @example
 * ```ts
 * const energy: EnergyRule = { regenMs: 120_000, max: 100 };
 * ```
 */
export type EnergyRule = { regenMs: number; max: number };

/**
 * All content tables the rules read.
 *
 * @example
 * ```ts
 * const tables: Tables = { chains, generators, orders, energy };
 * ```
 */
export type Tables = {
  chains: ChainTable;
  generators: GeneratorTable;
  orders: OrderTable;
  energy: EnergyRule;
};

/**
 * Randomness as a structural interface; the engine's stream satisfies it.
 *
 * @example
 * ```ts
 * const rng: Rng = { int: maxExclusive => seeded.next() % maxExclusive };
 * ```
 */
export type Rng = { int(maxExclusive: number): number };

/**
 * Result of `merge`.
 *
 * @example
 * ```ts
 * const result: MergeResult = rules.merge(state, "c0_0", "c1_0", tables);
 * if (result.legal) save(result.state);
 * ```
 */
export type MergeResult =
  | { legal: false; reason: "empty" | "different" | "top" | "same-cell" }
  | { legal: true; state: MergeState; item: Item };

/**
 * Result of `sell`.
 *
 * @example
 * ```ts
 * const result: SellResult = rules.sell(state, "i1", tables);
 * if (result.ok) showCoins(result.coins);
 * ```
 */
export type SellResult =
  | { ok: false; reason: "missing" }
  | { ok: true; state: MergeState; coins: number };

/**
 * Result of `tapGenerator`.
 *
 * @example
 * ```ts
 * const result: TapResult = rules.tapGenerator(state, "sawmill", now, tables, rng);
 * if (!result.ok) showReason(result.reason);
 * ```
 */
export type TapResult =
  | { ok: false; reason: "noEnergy" | "boardFull" | "cooling" }
  | { ok: true; state: MergeState; item: Item };

/**
 * Input of `giveToOrder`.
 *
 * @example
 * ```ts
 * const input: GiveInput = { item: "i1", order: 0 };
 * ```
 */
export type GiveInput = { item: ItemId; order: number };

/**
 * Result of `giveToOrder`.
 *
 * @example
 * ```ts
 * const result: GiveResult = rules.giveToOrder(state, { item: "i1", order: 0 }, tables, rng);
 * if (result.ok && result.completed) showReward(result.rewardId);
 * ```
 */
export type GiveResult =
  | { ok: false; reason: "missing" | "no-match" }
  | { ok: true; state: MergeState; completed: boolean; rewardId?: string };

/**
 * Result of `place`.
 *
 * @example
 * ```ts
 * const result: PlaceResult = rules.place(state, "i1");
 * if (result.ok) highlightSlot(result.slot);
 * ```
 */
export type PlaceResult =
  | { ok: false; reason: "full" }
  | { ok: true; state: MergeState; slot: number };

/**
 * Result of `take`.
 *
 * @example
 * ```ts
 * const result: TakeResult = rules.take(state, 0);
 * if (result.ok) showItem(result.item);
 * ```
 */
export type TakeResult =
  | { ok: false; reason: "empty" | "boardFull" }
  | { ok: true; state: MergeState; item: Item };
