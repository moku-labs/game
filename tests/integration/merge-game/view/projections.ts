/**
 * @file The three projections of the board: the grid, the items and the generator. Each turns
 * keyed rows of the save into entities, and every gesture is a component of the view — the drop
 * target names the intent, so this game writes no drag code.
 */
import { Draggable, DropTarget, Tappable } from "@moku-labs/game";
import type { AssetKey } from "../generated/assets";
import { projection, sprite } from "../kit";
import type { CellId, GeneratorTable, Item as MergeItem } from "../rules";
import type { Player } from "../state";
import { tables } from "../tables";
import { Item } from "./components";
import { cellCenter, cellsOf } from "./layout";
import { itemLevelUp, itemMergeInto, itemPopIn, itemSlideTo } from "./motions";

/** The tile of every level of every chain. Generated keys, so a missing tile does not compile. */
const itemTextures: Record<string, readonly AssetKey[]> = {
  wood: ["board.item-wood-1", "board.item-wood-2", "board.item-wood-3", "board.item-wood-4"]
};

/** The generator table under the loose key type, so an id read from a save can be looked up. */
const generatorTable: GeneratorTable = tables.generators;

/**
 * One generator as the view reads it: where it stands and whether it still has charges.
 *
 * @example
 * ```ts
 * const generator: GeneratorView = { id: "sawmill", cell: "c0_0", charges: 4 };
 * ```
 */
export type GeneratorView = { id: string; cell: CellId; charges: number };

/**
 * The tile of one item. A chain or a level the tile table does not know falls back to the first
 * tile of the wood chain, so a content mistake is visible instead of invisible.
 *
 * @param item - The item to draw.
 * @returns The asset key of its tile.
 * @example
 * ```ts
 * itemTexture({ id: "i1", chain: "wood", level: 2, cell: "c1_0" }); // "board.item-wood-2"
 * ```
 */
function itemTexture(item: MergeItem): AssetKey {
  return itemTextures[item.chain]?.[item.level - 1] ?? "board.item-wood-1";
}

/**
 * Lists the generators of the save that the content tables still know. A generator the tables
 * dropped is not drawn.
 *
 * @param player - The saved player.
 * @returns One entry per generator on the board.
 */
function generatorsOf(player: Player): GeneratorView[] {
  const list: GeneratorView[] = [];

  for (const [id, state] of Object.entries(player.merge.generators)) {
    const entry = generatorTable[id];

    if (entry !== undefined) list.push({ id, cell: entry.cell, charges: state.charges });
  }

  return list;
}

/**
 * The grid under everything. A cell carries no `DropTarget`: this game has no move intent, so a
 * drop on an empty cell has no answer to give.
 */
export const boardCells = projection({
  name: "board.cells",
  layer: "cells",
  from: player => cellsOf(player.merge.board),
  key: cell => cell.id,
  view: cell => sprite({ texture: "board.cell", at: cellCenter(cell.id) })
});

/**
 * The items. Every one can be carried and every one is a drop target that answers `merge`, so the
 * payload of a drop is `{ from, to }` — exactly the input of the `merge` node.
 */
export const boardItems = projection({
  name: "board.items",
  layer: "items",
  lift: "lifted",
  from: player => player.merge.board.items,
  key: item => item.id,
  view: item => [
    Item({ chain: item.chain, level: item.level, cell: item.cell }),
    ...sprite({ texture: itemTexture(item), at: cellCenter(item.cell) }),
    Draggable({ payload: { from: item.cell } }),
    DropTarget({ intent: "merge", payload: { to: item.cell } })
  ],
  motion: {
    enter: itemPopIn,
    exit: itemMergeInto,
    // One hook per component, never both at once: this game moves an item or raises it, never both.
    change: { Transform: itemSlideTo, Item: itemLevelUp }
  }
});

/**
 * The generator, drawn among the items so it is sorted with them. A tap answers `tap` with the id
 * the `tapGenerator` node takes; an empty generator is drawn dim.
 */
export const boardGenerators = projection({
  name: "board.generators",
  layer: "items",
  from: player => generatorsOf(player),
  key: generator => generator.id,
  view: generator => [
    ...sprite({
      texture: "board.generator",
      at: cellCenter(generator.cell),
      alpha: generator.charges > 0 ? 1 : 0.4
    }),
    Tappable({ intent: "tap", payload: { generatorId: generator.id } })
  ]
});
