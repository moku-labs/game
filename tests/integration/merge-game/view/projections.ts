/**
 * @file The four projections of the board: the grid, the selection ring, the items and the
 * generator. Each turns keyed rows of the save or the session into entities, and every gesture is
 * a component of the view — the drop target names the intent, so this game writes no drag code.
 *
 * An item answers a tap too: a finger that stays put selects it (`select`), a finger that moves
 * carries it, and the input plugin tells the two apart.
 *
 * The board slot of the HUD hosts all four, so every view is drawn in the slot's own space
 * (0..970) and scales with it. `Order` sorts them inside the slot: cells, then the selection ring,
 * then the generator, then the items.
 */
import { Draggable, DropTarget, Order, Shape, Tappable, Transform } from "@moku-labs/game";
import type { AssetKey } from "../generated/assets";
import { NineSlice, projection, Sprite } from "../kit";
import type { CellId, GeneratorTable } from "../rules";
import type { Player, Session } from "../state";
import { tables } from "../tables";
import { Item } from "./components";
import { pictureOf } from "./items";
import type { BoardCell } from "./layout";
import { cellBox, cellsOf, itemSize } from "./layout";
import { itemLevelUp, itemMergeInto, itemPopIn, itemSlideTo } from "./motions";
import { selectedOf } from "./selection";

/**
 * Draw order inside the board slot: the grass, the selection ring on it, the generator, the items.
 */
const depth = { cells: 0, selection: 1, generators: 2, items: 3 } as const;

/** The selection ring (design §6 F9): a honey stroke along the rim of the cell, round like the grass. */
const ring = { color: 0xff_c2_33, width: 6, radius: 36 } as const;

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
 * The components of a picture that stands on a cell: a sprite fitted into the item box on the
 * middle of the cell, sorted at the given depth of the slot.
 *
 * @param texture - The asset key of the picture.
 * @param cell - The cell it stands on.
 * @param level - Its depth inside the slot.
 * @param alpha - How opaque it is drawn.
 * @returns The `Sprite`, the `Transform` and the `Order`.
 */
function onCell(texture: AssetKey, cell: CellId, level: number, alpha = 1) {
  const { middle } = cellBox(cell);

  return [
    Sprite({ texture, width: itemSize, height: itemSize, fit: "contain", alpha }),
    Transform({ x: middle.x, y: middle.y }),
    Order({ value: level })
  ] as const;
}

/**
 * The grid under everything: one grass nine-slice per cell, drawn from the corner of the cell. A
 * cell carries no `DropTarget`: this game has no move intent, so a drop on an empty cell has no
 * answer to give.
 */
export const boardCells = projection({
  name: "board.cells",
  layer: "cells",
  from: player => cellsOf(player.merge.board),
  key: cell => cell.id,
  view: cell => {
    const box = cellBox(cell.id);

    return [
      NineSlice({ texture: "board.cell", width: box.size, height: box.size }),
      Transform({ x: box.x, y: box.y }),
      Order({ value: depth.cells })
    ];
  }
});

/**
 * The cell the ring goes on: the cell of the selected thing, none while nothing is selected.
 *
 * @param player - The saved player.
 * @param session - The session, which keeps the selected id.
 * @returns One cell, or none.
 */
function selectedCells(player: Player, session: Session): BoardCell[] {
  const selected = selectedOf(player, session);

  return selected === undefined ? [] : [{ id: selected.cell }];
}

/**
 * The selection ring (design §6 F9): a honey stroke around the cell of the thing the player
 * selected, the sawmill or an item, none while nothing is. The fill is not drawn, so the grass
 * shows through the ring.
 */
export const boardSelection = projection({
  name: "board.selection",
  layer: "cells",
  from: selectedCells,
  key: cell => cell.id,
  view: cell => {
    const box = cellBox(cell.id);

    return [
      Shape({
        w: box.size,
        h: box.size,
        fillAlpha: 0,
        stroke: ring.color,
        strokeWidth: ring.width,
        radius: ring.radius
      }),
      Transform({ x: box.x, y: box.y }),
      Order({ value: depth.selection })
    ];
  }
});

/**
 * The items. Every one can be carried and every one is a drop target that answers `merge`, so the
 * payload of a drop is `{ from, to }` — exactly the input of the `merge` node. A tap answers
 * `select` with the item's id, the input of the `select` node.
 */
export const boardItems = projection({
  name: "board.items",
  layer: "items",
  lift: "lifted",
  from: player => player.merge.board.items,
  key: item => item.id,
  view: item => [
    Item({ chain: item.chain, level: item.level, cell: item.cell }),
    ...onCell(pictureOf(item.chain, item.level), item.cell, depth.items),
    Tappable({ intent: "select", payload: { id: item.id } }),
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
 * The generator, drawn in the items layer under the items. A tap answers `tap` with the id the
 * `tapGenerator` node takes; an empty generator is drawn dim.
 */
export const boardGenerators = projection({
  name: "board.generators",
  layer: "items",
  from: player => generatorsOf(player),
  key: generator => generator.id,
  view: generator => [
    ...onCell("board.generator", generator.cell, depth.generators, generator.charges > 0 ? 1 : 0.4),
    Tappable({ intent: "tap", payload: { generatorId: generator.id } })
  ]
});
