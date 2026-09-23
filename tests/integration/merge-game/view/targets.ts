/**
 * @file Which view of the board stands on a cell, as an animation target: the item on it, or the
 * generator whose cell it is. A node that refuses a drop names the cell; the shake aims at what is
 * drawn there.
 */
import type { Anim } from "@moku-labs/game";
import type { CellId, GeneratorTable } from "../rules";
import type { Player } from "../state";
import { tables } from "../tables";

/** The generator table under the loose key type, so an id read from a save can be looked up. */
const generatorTable: GeneratorTable = tables.generators;

/**
 * The view that stands on one cell. An item wins over a generator, which a save never has on the
 * same cell.
 *
 * @param player - The saved player.
 * @param cell - The address of the cell.
 * @returns The projection key of the view, or `undefined` for an empty cell.
 */
export function viewAt(player: Player, cell: CellId): Anim.Target | undefined {
  const item = player.merge.board.items.find(each => each.cell === cell);

  if (item !== undefined) return { projection: "board.items", key: item.id };

  const generator = Object.keys(player.merge.generators).find(
    id => generatorTable[id]?.cell === cell
  );

  return generator === undefined ? undefined : { projection: "board.generators", key: generator };
}
