/**
 * @file What the player selected on the board (design §6 F9, B4): the sawmill or one item, read
 * from the id the session keeps. The marching ring and the info bar both read it here, so they
 * never disagree. The id follows the item, not the cell: an item that rose in a merge keeps its id
 * and stays selected. While the id names nothing, at the start or after the selected item merged
 * away or was delivered, the sawmill is the selected thing, as the design shows the board.
 */
import type { CellId, GeneratorTable } from "../rules";
import type { Player, Session } from "../state";
import { generatorId, tables } from "../tables";

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
 * Reads a generator of the save by its id.
 *
 * @param player - The saved player.
 * @param id - The id to look up.
 * @returns The generator with its cell, or `undefined` when the tables or the save lack it.
 */
function generatorOf(player: Player, id: string): Selected | undefined {
  const generator = generatorTable[id];

  return generator !== undefined && player.merge.generators[id] !== undefined
    ? { kind: "generator", id, cell: generator.cell }
    : undefined;
}

/**
 * Reads the selected thing out of the save and the session. A generator id wins over an item id
 * of the same name, which a save never has. An id that names nothing selects the sawmill.
 *
 * @param player - The saved player.
 * @param session - The session, which keeps the selected id.
 * @returns The selected generator or item, or `undefined` only for a save without the sawmill.
 */
export function selectedOf(player: Player, session: Session): Selected | undefined {
  const id = session.selected;
  const generator = generatorOf(player, id);

  if (generator !== undefined) return generator;

  const item = player.merge.board.items.find(each => each.id === id);

  return item === undefined
    ? generatorOf(player, generatorId)
    : { kind: "item", id, cell: item.cell, chain: item.chain, level: item.level };
}
