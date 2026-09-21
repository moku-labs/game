/**
 * @file The state of the fixture merge game: what a save holds, what one session holds, the state
 * of a new player, and the one helper that writes a rules result back into a draft.
 */
import type { MergeState } from "./rules";
import { boardSize, generatorId, startingOrders, tables } from "./tables";

/** The saved player: the rule state plus what this game keeps beside it. */
export type Player = {
  /** Everything the rules own: board, energy, generators, orders, wallet, inventory. */
  merge: MergeState;
  /** Reward ids the player took out of the reward popup, oldest first. */
  claimed: string[];
};

/** The session: what one run of the game keeps and never saves. */
export type Session = {
  /** Generator taps in this session. */
  taps: number;
  /** Reward waiting in the popup, `""` when none is pending. */
  pendingReward: string;
};

/** The state of a new player. */
export const startingPlayer: Player = {
  merge: {
    board: { ...boardSize, items: [] },
    energy: { value: tables.energy.max, max: tables.energy.max, countedAt: 0 },
    generators: { [generatorId]: { readyAt: 0, charges: tables.generators.sawmill.maxCharges } },
    orders: startingOrders,
    wallet: { coins: 0 },
    // eslint-disable-next-line unicorn/no-null -- `null` is an empty inventory slot in the rules.
    inventory: [null, null, null],
    nextItemId: 1
  },
  claimed: []
};

/** The session at every start. */
export const startingSession: Session = { taps: 0, pendingReward: "" };

/**
 * Writes the state a rules function returned into the player draft. The rules are pure and build
 * a new tree; the node context hands out an Immer draft, so one assignment per node is all the
 * bridging a game needs.
 *
 * @param player - The player draft of the open transaction.
 * @param state - The rule state a rules function returned.
 * @example
 * ```ts
 * if (result.legal) applyRules(player, result.state);
 * ```
 */
export function applyRules(player: Player, state: MergeState): void {
  player.merge = state;
}
