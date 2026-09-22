/**
 * @file Where the board sits on the screen. The rules address a cell as `c<col>_<row>` and know
 * nothing about pixels; this file is the one place that turns an address into a point of the
 * reference resolution (1080 wide, portrait).
 */
import type { Board, CellId } from "../rules";

/** Edge length of one cell in reference units. */
const cellSize = 240;

/** Reference x of the left edge of the board: three columns of 240, centred in 1080. */
const boardLeft = 180;

/** Reference y of the top edge of the board. */
const boardTop = 600;

/**
 * A point of the reference resolution.
 *
 * @example
 * ```ts
 * const at: Point = { x: 300, y: 720 };
 * ```
 */
export type Point = { x: number; y: number };

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
 * The centre of a cell in reference units: where a sprite of that cell is drawn.
 *
 * @param cell - The address of the cell.
 * @returns The point the sprite sits on.
 * @example
 * ```ts
 * cellCenter("c0_0"); // { x: 300, y: 720 }
 * ```
 */
export function cellCenter(cell: CellId): Point {
  const { col, row } = coordinatesOf(cell);

  return {
    x: boardLeft + col * cellSize + cellSize / 2,
    y: boardTop + row * cellSize + cellSize / 2
  };
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
