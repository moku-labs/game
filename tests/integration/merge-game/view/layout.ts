/**
 * @file Where a cell sits inside the board slot. The rules address a cell as `c<col>_<row>` and
 * know nothing about pixels; this file turns an address into a box of the slot's own space. The
 * slot is a ui element that hosts the three board projections, so these are local units (0..970):
 * `ui` lays the slot out on the screen and scales it to fit, and nothing here knows the screen.
 */
import type { Board, CellId } from "../rules";

/** The board slot: a square of 970 units, the tray drawn over all of it (design §5.5). */
export const slot = { size: 970, inset: 55, gap: 10 } as const;

/** Edge length of one cell: three cells and two gaps fill the tray inside its inset. */
export const cellSize = (slot.size - 2 * slot.inset - 2 * slot.gap) / 3;

/** Edge length of the box an item or the generator is drawn into: the cell less its grass rim. */
export const itemSize = Math.round(cellSize * 0.82);

/**
 * A point of the slot's own space.
 *
 * @example
 * ```ts
 * const at: Point = { x: 485, y: 195 };
 * ```
 */
export type Point = { x: number; y: number };

/**
 * The box of one cell in the slot's own space: its top-left corner, its size and its middle.
 *
 * @example
 * ```ts
 * const box: CellBox = { x: 345, y: 55, size: 280, middle: { x: 485, y: 195 } };
 * ```
 */
export type CellBox = { x: number; y: number; size: number; middle: Point };

/**
 * One cell of the board as the view reads it. A cell has nothing but its address; what stands on
 * it is an item, and items are their own projection.
 *
 * @example
 * ```ts
 * const cell: BoardCell = { id: "c0_0" };
 * ```
 */
export type BoardCell = { id: CellId };

/**
 * Reads the column and the row out of a cell address. An address that is not of the form
 * `c<col>_<row>` reads as the top-left cell, so a broken save draws instead of throwing.
 *
 * @param cell - The address to read.
 * @returns The zero-based column and row.
 * @example
 * ```ts
 * coordinatesOf("c2_1"); // { col: 2, row: 1 }
 * ```
 */
function coordinatesOf(cell: CellId): { col: number; row: number } {
  const separator = cell.indexOf("_");
  const col = Number(cell.slice(1, separator));
  const row = Number(cell.slice(separator + 1));

  return {
    col: Number.isInteger(col) ? col : 0,
    row: Number.isInteger(row) ? row : 0
  };
}

/**
 * The box of a cell in the slot's own space: a cell nine-slice is drawn from its corner, an item
 * sprite on its middle.
 *
 * @param cell - The address of the cell.
 * @returns The corner, the size and the middle of the cell.
 * @example
 * ```ts
 * cellBox("c1_0"); // { x: 345, y: 55, size: 280, middle: { x: 485, y: 195 } }
 * ```
 */
export function cellBox(cell: CellId): CellBox {
  const { col, row } = coordinatesOf(cell);
  const x = slot.inset + col * (cellSize + slot.gap);
  const y = slot.inset + row * (cellSize + slot.gap);

  return { x, y, size: cellSize, middle: { x: x + cellSize / 2, y: y + cellSize / 2 } };
}

/**
 * Lists every cell of the board, row by row from the top-left. It is the `from` of the cell
 * projection: nine plain addresses, one entity each.
 *
 * @param board - The board that gives the size in columns and rows.
 * @returns One entry per cell.
 * @example
 * ```ts
 * cellsOf({ cols: 2, rows: 1, items: [] }); // [{ id: "c0_0" }, { id: "c1_0" }]
 * ```
 */
export function cellsOf(board: Board): BoardCell[] {
  const cells: BoardCell[] = [];

  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) cells.push({ id: `c${col}_${row}` });
  }

  return cells;
}
