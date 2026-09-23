/**
 * @file Prepared saves for the dev page, picked with `?player=<name>`. The e2e run opens the page on
 * a phone and needs states that take many taps to reach — a full board, an empty energy bar, an
 * order ready — so each is a save the page starts from. Test code of the fixture, never shipped.
 */
import type { Item } from "../rules";
import type { Player } from "../state";
import { startingPlayer } from "../state";

/** The coins every prepared save shows, the number the design's screens carry. */
const COINS = 125;

/**
 * An item of the wood chain on one cell.
 *
 * @param id - Item id.
 * @param level - Level in the chain.
 * @param cell - Cell id, `c<col>_<row>`.
 * @returns The item.
 * @example
 * ```ts
 * wood("i1", 3, "c1_1"); // { id: "i1", chain: "wood", level: 3, cell: "c1_1" }
 * ```
 */
function wood(id: string, level: number, cell: string): Item {
  return { id, chain: "wood", level, cell };
}

/**
 * The starting save with other items, energy and coins.
 *
 * @param items - What lies on the board.
 * @param energy - The energy left, of the table's maximum.
 * @returns The prepared player.
 * @example
 * ```ts
 * prepared([wood("i1", 3, "c1_1")], 7).merge.energy.value; // 7
 * ```
 */
function prepared(items: Item[], energy: number): Player {
  return {
    ...startingPlayer,
    merge: {
      ...startingPlayer.merge,
      board: { ...startingPlayer.merge.board, items },
      energy: { ...startingPlayer.merge.energy, value: energy },
      wallet: { coins: COINS },
      nextItemId: items.length + 1
    }
  };
}

/** The saves the page knows, by the name `?player=` gives. */
export const scenarios: Readonly<Record<string, Player>> = {
  // The design's board: a Plank ready for order 1, two Twigs and a Log.
  ready: prepared(
    [wood("i1", 1, "c1_0"), wood("i2", 1, "c2_1"), wood("i3", 2, "c0_2"), wood("i4", 3, "c1_1")],
    7
  ),
  // Every free cell taken: a tap on the sawmill plays the board-full toast.
  full: prepared(
    [
      wood("i1", 1, "c1_0"),
      wood("i2", 2, "c2_0"),
      wood("i3", 1, "c0_1"),
      wood("i4", 3, "c1_1"),
      wood("i5", 1, "c2_1"),
      wood("i6", 2, "c0_2"),
      wood("i7", 4, "c1_2"),
      wood("i8", 1, "c2_2")
    ],
    7
  ),
  // No energy left: a tap on the sawmill opens the out-of-energy popup.
  empty: prepared([wood("i1", 2, "c1_0"), wood("i2", 1, "c2_1")], 0)
};

/**
 * The save the page starts from: the one `?player=` names, or the starting save.
 *
 * @param search - `location.search` of the page.
 * @returns The player to seed the model with.
 * @example
 * ```ts
 * playerFor("?player=full").merge.board.items.length; // 8
 * ```
 */
export function playerFor(search: string): Player {
  const name = new URLSearchParams(search).get("player") ?? "";
  const scenario = scenarios[name];

  if (scenario === undefined) return startingPlayer;

  // The energy is counted from the moment the page opens, or `boot` refills a bar left at zero.
  const energy = { ...scenario.merge.energy, countedAt: Date.now() };

  return { ...scenario, merge: { ...scenario.merge, energy } };
}
