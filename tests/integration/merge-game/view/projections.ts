/**
 * @file The projections of the board: the grid, the glows over it, the selection ring, the items
 * and the generator. Each turns keyed rows of the save or the session into entities, and every
 * gesture is a component of the view — the drop target names the intent, so this game writes no
 * drag code.
 *
 * An item answers a tap too: a finger that stays put selects it (`select`), a finger that moves
 * carries it, and the input plugin tells the two apart.
 *
 * The board slot of the HUD hosts them all, so every view is drawn in the slot's own space
 * (0..970) and scales with it. `Order` sorts them inside the slot (`depth` of `layout.ts`).
 */
import { Draggable, DropTarget, Order, Shape, Tappable, Transform } from "@moku-labs/game";
import type { AssetKey } from "../generated/assets";
import { NineSlice, projection, Sprite } from "../kit";
import type { CellId, GeneratorTable } from "../rules";
import type { Player, Session } from "../state";
import { tables } from "../tables";
import { Generator, Glow, Item, SelectionRing } from "./components";
import { pictureOf } from "./items";
import type { BoardCell } from "./layout";
import { cellBox, cellsOf, depth, itemSize } from "./layout";
import { itemLevelUp, itemMergeInto, itemPopIn, itemSlideTo } from "./motions";
import { ringFrames, ringSize } from "./ring";
import { selectedOf } from "./selection";

/** The corner radius of a glow: round like the grass of the cell. */
const glowRadius = 36;

/** The colours a generator is drawn in: its own, or greyed while it cannot give (design §6 F11). */
const generatorTint = { ready: 0xff_ff_ff, disabled: 0x9a_9a_9a } as const;

/** The generator table under the loose key type, so an id read from a save can be looked up. */
const generatorTable: GeneratorTable = tables.generators;

/**
 * One generator as the view reads it: where it stands and whether a tap can make it give: it has
 * a charge left and the bar holds the energy a tap costs.
 *
 * @example
 * ```ts
 * const generator: GeneratorView = { id: "sawmill", cell: "c0_0", ready: true };
 * ```
 */
export type GeneratorView = { id: string; cell: CellId; ready: boolean };

/**
 * Lists the generators of the save that the content tables still know. A generator the tables
 * dropped is not drawn.
 *
 * @param player - The saved player.
 * @returns One entry per generator on the board.
 */
export function generatorsOf(player: Player): GeneratorView[] {
  const list: GeneratorView[] = [];
  const energy = player.merge.energy.value;

  for (const [id, state] of Object.entries(player.merge.generators)) {
    const entry = generatorTable[id];

    if (entry === undefined) continue;

    list.push({
      id,
      cell: entry.cell,
      ready: state.charges > 0 && energy >= entry.energyCost
    });
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
 * @param tint - The colour it is drawn in.
 * @returns The `Sprite`, the `Transform` and the `Order`.
 */
function onCell(texture: AssetKey, cell: CellId, level: number, tint = 0xff_ff_ff) {
  const { middle } = cellBox(cell);

  return [
    Sprite({ texture, width: itemSize, height: itemSize, fit: "contain", tint }),
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
 * The glow over every cell (design §4, §6 F7): drawn over the grass and under the ring, and not
 * drawn at rest. The `glowCells` system lights it: cream along the rim of the cell under the
 * mouse, gold and pulsing on a legal target of the item in the hand.
 */
export const boardGlows = projection({
  name: "board.glows",
  layer: "glows",
  from: player => cellsOf(player.merge.board),
  key: cell => cell.id,
  view: cell => {
    const box = cellBox(cell.id);

    return [
      Glow({ cell: cell.id }),
      Shape({ w: box.size, h: box.size, radius: glowRadius, fillAlpha: 0, alpha: 0 }),
      Transform({ x: box.x, y: box.y }),
      Order({ value: depth.glows })
    ];
  }
});

/**
 * The cell the ring goes on: the cell of the selected thing, none for a save without the sawmill.
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
 * The selection ring (design §6 F9): marching cream dashes around the cell of the thing the
 * player selected, the sawmill or an item. Nothing selected means the sawmill, as in the info
 * bar. The picture is centred on the cell and 14 units larger on every side, so the dashes lie in
 * the gap between the cells; `marchRing` walks them.
 */
export const boardSelection = projection({
  name: "board.selection",
  layer: "cells",
  from: selectedCells,
  key: cell => cell.id,
  view: cell => {
    const { middle } = cellBox(cell.id);

    return [
      Sprite({ texture: ringFrames[0], width: ringSize, height: ringSize }),
      SelectionRing(),
      Transform({ x: middle.x, y: middle.y }),
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
 * `tapGenerator` node takes; a generator with no charge or no energy is greyed and still answers
 * (design §6 F11). It is a drop target too: an item dropped on it answers `merge`, which the rules
 * refuse, so the sawmill shakes (design §4).
 */
export const boardGenerators = projection({
  name: "board.generators",
  layer: "items",
  from: player => generatorsOf(player),
  key: generator => generator.id,
  view: generator => [
    Generator({ id: generator.id, cell: generator.cell }),
    ...onCell(
      "board.generator",
      generator.cell,
      depth.generators,
      generator.ready ? generatorTint.ready : generatorTint.disabled
    ),
    Tappable({ intent: "tap", payload: { generatorId: generator.id } }),
    DropTarget({ intent: "merge", payload: { to: generator.cell } })
  ]
});
