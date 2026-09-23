/**
 * @file What the player selected on the board (design §6 F9, B4): the sawmill or one item, read
 * from the id the session keeps. The honey ring and the info bar both read it here, so they never
 * disagree. The id follows the item, not the cell: an item that rose in a merge keeps its id and
 * stays selected, and an id that names nothing on the board any more, a merged-away or delivered
 * item, selects nothing.
 */
import type { CellId, GeneratorTable } from "../rules";
import type { Player, Session } from "../state";
import { tables } from "../tables";

/** The generator table under the loose key type, so an id read from the session can be looked up. */
const generatorTable: GeneratorTable = tables.generators;

/**
 * The thing the player selected, with the cell it stands on.
 *
 * @example
 * ```ts
 * const sawmill: Selected = { kind: "generator", id: "sawmill", cell: "c0_0" };
 * const plank: Selected = { kind: "item", id: "i1", cell: "c1_0", chain: "wood", level: 3 };
 * ```
 */
export type Selected =
  | { kind: "generator"; id: string; cell: CellId }
  | { kind: "item"; id: string; cell: CellId; chain: string; level: number };

/**
 * Reads the selected thing out of the save and the session. A generator id wins over an item id
 * of the same name, which a save never has.
 *
 * @param player - The saved player.
 * @param session - The session, which keeps the selected id.
 * @returns The selected generator or item, or `undefined` while nothing on the board is selected.
 */
export function selectedOf(player: Player, session: Session): Selected | undefined {
  const id = session.selected;
  const generator = generatorTable[id];

  if (generator !== undefined && player.merge.generators[id] !== undefined) {
    return { kind: "generator", id, cell: generator.cell };
  }

  const item = player.merge.board.items.find(each => each.id === id);

  return item === undefined
    ? undefined
    : { kind: "item", id, cell: item.cell, chain: item.chain, level: item.level };
}
