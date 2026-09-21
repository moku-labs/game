import type { Item, MergeState, Rng, Tables } from "../types";

/**
 * Deep-freezes a value so that any mutation attempted by a rule throws in strict mode.
 * Every test feeds frozen inputs to prove the kit is pure.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;

  for (const child of Object.values(value)) deepFreeze(child);

  return Object.freeze(value);
}

/** Builds `count` empty inventory slots. */
export function emptySlots(count: number): (Item | null)[] {
  // eslint-disable-next-line unicorn/no-null -- an empty inventory slot is null in the save format
  return Array.from({ length: count }, () => null);
}

/** An rng that hands out a written list of integers and ignores `maxExclusive`. */
export function scriptedRng(values: readonly number[]): Rng {
  let index = 0;

  return {
    int() {
      const value = values[index] ?? 0;
      index += 1;
      return value;
    }
  };
}

/** A tiny seeded LCG, so the same seed repeats the same draws. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;

  return {
    int(maxExclusive: number) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state % maxExclusive;
    }
  };
}

/** The template game's content tables: one three-level chain, one manual generator, two orders. */
export const tables: Tables = deepFreeze({
  chains: {
    wood: { top: 3, sellPrice: [1, 3, 9] },
    stone: { top: 2, sellPrice: [2, 6] }
  },
  generators: {
    sawmill: {
      cell: "c2_2",
      energyCost: 2,
      cooldownMs: 60_000,
      maxCharges: 3,
      drops: [{ chain: "wood", level: 1, weight: 1 }]
    }
  },
  orders: [
    {
      needs: [
        { chain: "wood", level: 2 },
        { chain: "wood", level: 3 }
      ],
      rewardId: "coins-small",
      reward: { coins: 25 },
      weight: 3
    },
    {
      needs: [{ chain: "stone", level: 2 }],
      rewardId: "coins-large",
      reward: { coins: 100, gems: 1 },
      weight: 1
    }
  ],
  energy: { regenMs: 120_000, max: 10 }
});

/** The moment the mid-game state was last counted at. */
export const countedAt = 1_000_000;

/**
 * A mid-game save: a 5x5 board with row 0 filled, five energy of ten, a full sawmill,
 * one open order and an empty three-slot inventory.
 */
export function midGameState(): MergeState {
  return {
    board: {
      cols: 5,
      rows: 5,
      items: [
        { id: "i1", chain: "wood", level: 1, cell: "c0_0" },
        { id: "i2", chain: "wood", level: 1, cell: "c1_0" },
        { id: "i3", chain: "wood", level: 2, cell: "c2_0" },
        { id: "i4", chain: "wood", level: 3, cell: "c3_0" },
        { id: "i5", chain: "stone", level: 1, cell: "c4_0" }
      ]
    },
    energy: { value: 5, max: 10, countedAt },
    generators: { sawmill: { readyAt: 0, charges: 3 } },
    orders: [
      {
        id: 7,
        needs: [
          { chain: "wood", level: 2 },
          { chain: "wood", level: 3 }
        ],
        given: [],
        rewardId: "coins-small"
      }
    ],
    wallet: { coins: 100 },
    inventory: emptySlots(3),
    nextItemId: 6
  };
}

/** Fills every cell of a board with items, so `findFreeCell` has nothing left to find. */
export function filledItems(cols: number, rows: number): Item[] {
  const items: Item[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      items.push({ id: `f${col}_${row}`, chain: "wood", level: 1, cell: `c${col}_${row}` });
    }
  }

  return items;
}

/** The mid-game state with a board that has no free cell at all. */
export function fullBoardState(): MergeState {
  const state = midGameState();

  return { ...state, board: { ...state.board, items: filledItems(5, 5) } };
}
