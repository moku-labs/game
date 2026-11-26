/**
 * @file The board of the stress bench, as world projections: 63 cells, and per item a shadow, a picture and a ring,
 * the three views an item of the real game has at least. One sparkle emitter per eighth item. A merge takes two
 * items off and brings one, so views leave and enter on a commit.
 */
import { Shape, Sprite, Transform } from "../../../../src/index.ts";
import { Emitter, projection } from "../../kit";
import type { Player, Session } from "../../state";

/** The columns of the field. */
const COLUMNS = 7;

/** The side of a cell. */
const CELL = 52;

/** The left and the top of the field. */
const LEFT = 13 + CELL / 2;
const TOP = 190 + CELL / 2;

/** One item of the board: its id and its cell. */
export type BoardItem = { id: string; x: number; y: number };

/**
 * The middle of a cell.
 *
 * @param cell - The cell, row by row.
 * @returns Its x and y.
 * @example
 * ```ts
 * placeOf(8); // { x: 91, y: 268 }
 * ```
 */
export function placeOf(cell: number): { x: number; y: number } {
  return { x: LEFT + (cell % COLUMNS) * CELL, y: TOP + Math.floor(cell / COLUMNS) * CELL };
}

/**
 * The items on the board after a number of merges. Merge `n` takes the items of two cells off and brings a new one
 * to the first of them, so every commit has two exits and one enter, and the board never empties: the second cell
 * gets its item back two merges later.
 *
 * @param session - The session.
 * @returns The items.
 */
export function itemsOf(session: Session): BoardItem[] {
  if (session.scene !== "board" && session.scene !== "worst") return [];

  const items: BoardItem[] = [];
  const { merges } = session;
  const first = (merges * 5) % session.items;
  const second = (merges * 5 + 1) % session.items;

  for (let cell = 0; cell < session.items; cell += 1) {
    if (merges > 0 && cell === second) continue;

    const born = merges > 0 && cell === first ? merges : 0;

    items.push({ id: `c${cell}g${born}`, ...placeOf(cell) });
  }

  return items;
}

/** The drop rects of the cells: one invisible shape each, as the game's `board.cells`. */
export const boardCells = projection({
  name: "board.cells",
  layer: "board",
  from: (_player: Player, session: Session): BoardItem[] =>
    session.scene === "board" || session.scene === "worst"
      ? Array.from({ length: session.items }, (_unused, cell) => ({
          id: `cell${cell}`,
          ...placeOf(cell)
        }))
      : [],
  key: (item: BoardItem) => item.id,
  view: (item: BoardItem) => [
    Shape({ w: CELL - 2, h: CELL - 2, radius: 8, fill: 0x2a_33_3d }),
    Transform({ x: item.x, y: item.y })
  ]
});

/** The shadows of the items. */
export const boardShadows = projection({
  name: "board.shadows",
  layer: "board",
  from: (_player: Player, session: Session): BoardItem[] => itemsOf(session),
  key: (item: BoardItem) => item.id,
  view: (item: BoardItem) => [
    Sprite({ texture: "ui.pv-item", width: 46, height: 46, tint: 0, alpha: 0.25 }),
    Transform({ x: item.x + 2, y: item.y + 4 })
  ]
});

/** The pictures of the items: the driver writes their scale and turn each frame. */
export const boardPictures = projection({
  name: "board.pictures",
  layer: "board",
  from: (_player: Player, session: Session): BoardItem[] => itemsOf(session),
  key: (item: BoardItem) => item.id,
  view: (item: BoardItem) => [
    Sprite({ texture: "ui.pv-item", width: 44, height: 44 }),
    Transform({ x: item.x, y: item.y })
  ]
});

/** The timer rings of the items: an arc each, its sweep written by the driver as a ring of the game steps. */
export const boardRings = projection({
  name: "board.rings",
  layer: "board",
  from: (_player: Player, session: Session): BoardItem[] => itemsOf(session),
  key: (item: BoardItem) => item.id,
  view: (item: BoardItem) => [
    Shape({ kind: "arc", w: 18, h: 18, stroke: 0xff_cc_55, strokeWidth: 3, sweep: 0.5 }),
    Transform({ x: item.x + 14, y: item.y - 14 })
  ]
});

/** The sparkles: an emitter on every eighth cell. */
export const boardMarks = projection({
  name: "board.marks",
  layer: "board",
  from: (_player: Player, session: Session): BoardItem[] =>
    session.scene === "board" || session.scene === "worst"
      ? Array.from({ length: Math.ceil(session.items / 8) }, (_unused, index) => ({
          id: `mark${index}`,
          ...placeOf(index * 8)
        }))
      : [],
  key: (item: BoardItem) => item.id,
  view: (item: BoardItem) => [
    Emitter({ effect: "fx.sparkle" }),
    Transform({ x: item.x, y: item.y })
  ]
});
