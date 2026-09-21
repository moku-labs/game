/**
 * @file Merge kit — grid helpers skeleton. Pure functions over the board.
 */
import type { Board, CellId, Item } from "./types";

/**
 * Lists the cells that touch a cell on the board, in a fixed order, without cells outside the board.
 *
 * @param _board - The board that gives the size in columns and rows.
 * @param _cell - The cell whose neighbours are listed.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const around = neighbors(state.board, "c0_0");
 * ```
 */
export function neighbors(_board: Board, _cell: CellId): CellId[] {
  throw new Error("not implemented");
}

/**
 * Finds a free cell on the board. The scan order is fixed (nearest ring around `_near` first,
 * then row-major), so the result is deterministic. Returns `undefined` when the board is full.
 *
 * @param _board - The board to scan.
 * @param _near - Optional cell to search around first.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const cell = findFreeCell(state.board, "c3_4");
 * if (cell === undefined) showBoardFull();
 * ```
 */
export function findFreeCell(_board: Board, _near?: CellId): CellId | undefined {
  throw new Error("not implemented");
}

/**
 * Returns the item that stands on a cell, or `undefined` when the cell is empty.
 *
 * @param _board - The board to read.
 * @param _cell - The cell to look at.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const item = itemAt(state.board, "c2_1");
 * ```
 */
export function itemAt(_board: Board, _cell: CellId): Item | undefined {
  throw new Error("not implemented");
}
