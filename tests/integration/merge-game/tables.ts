/**
 * @file Content of the fixture merge game as plain data: the board, one chain of four levels,
 * one generator with charges and a cooldown, three order slots and the energy rule.
 */
import type { Board, Order, Tables } from "./rules";

/** The board the game is played on. Small on purpose: nine cells fill up fast. */
export const boardSize: Pick<Board, "cols" | "rows"> = { cols: 3, rows: 3 };

/** The generator the board carries. One key, so a tap never has to choose. */
export const generatorId = "sawmill";

/** Every content table the rules read. */
export const tables = {
  chains: { wood: { top: 4, sellPrice: [0, 2, 6, 14] } },
  generators: {
    sawmill: {
      cell: "c0_0",
      energyCost: 1,
      cooldownMs: 60_000,
      maxCharges: 4,
      drops: [{ chain: "wood", level: 1, weight: 1 }]
    }
  },
  orders: [
    { needs: [{ chain: "wood", level: 3 }], rewardId: "planks", reward: { coins: 25 }, weight: 1 },
    {
      needs: [
        { chain: "wood", level: 2 },
        { chain: "wood", level: 2 }
      ],
      rewardId: "logs",
      reward: { coins: 8 },
      weight: 1
    },
    { needs: [{ chain: "wood", level: 4 }], rewardId: "beams", reward: { coins: 60 }, weight: 1 }
  ],
  // Ten minutes per energy point: the generator cooldown is always the nearer timer.
  energy: { regenMs: 600_000, max: 10 }
} satisfies Tables;

/** The three order slots a new player starts with. The last one reaches the top of the chain. */
export const startingOrders: Order[] = [
  { id: 0, needs: [{ chain: "wood", level: 3 }], given: [], rewardId: "planks" },
  {
    id: 1,
    needs: [
      { chain: "wood", level: 2 },
      { chain: "wood", level: 2 }
    ],
    given: [],
    rewardId: "logs"
  },
  { id: 2, needs: [{ chain: "wood", level: 4 }], given: [], rewardId: "beams" }
];

/** The coins the daily gift of Home pays (design §8). */
export const giftCoins = 50;
