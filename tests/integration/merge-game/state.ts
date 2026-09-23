/**
 * @file The state of the fixture merge game: what a save holds, what one session holds, the state
 * of a new player, and the one helper that writes a rules result back into a draft.
 */
import type { MergeState } from "./rules";
import { boardSize, generatorId, startingOrders, tables } from "./tables";

/** What the settings screen writes: the three buses and the language of the interface. */
export type Settings = {
  /** Bus name to gain, 0..1. `audio` reads it back on every commit. */
  audio: { master: number; music: number; sfx: number };
  /** The locale the player chose. `i18n` is switched from the node that writes it. */
  locale: string;
};

/** The saved player: the rule state plus what this game keeps beside it. */
export type Player = {
  /** Everything the rules own: board, energy, generators, orders, wallet, inventory. */
  merge: MergeState;
  /** Reward ids the player took out of the reward popup, oldest first. */
  claimed: string[];
  /**
   * The reward waiting in the popup, `""` when none is pending. Saved, because the popup is an
   * effect of a transit node and not a rest point: a reload has to find it again.
   */
  pendingReward: string;
  /** The coins that order paid, held back until the player takes them out of the popup. */
  pendingCoins: number;
  /** What the settings screen last wrote. */
  settings: Settings;
  /** Whether the daily gift of Home was taken. The gift button shows its "1" badge until it is. */
  giftClaimed: boolean;
};

/** The session: what one run of the game keeps and never saves. */
export type Session = {
  /** Generator taps in this session. */
  taps: number;
  /** How far the splash has loaded the bundles Home and the board need, 0..1. */
  loading: number;
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
  claimed: [],
  pendingReward: "",
  pendingCoins: 0,
  settings: { audio: { master: 1, music: 0.6, sfx: 1 }, locale: "ru" },
  giftClaimed: false
};

/** The session at every start. */
export const startingSession: Session = { taps: 0, loading: 0 };

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
