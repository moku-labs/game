/**
 * @file Merge kit — grid helpers. Pure functions over the board, with fixed scan orders.
 */
import type { Board, CellId, Item, ItemId } from "./types";

/**
 * A cell address split into its zero-based column and row.
 *
 * @example
 * ```ts
 * const at: Coordinates = { col: 2, row: 3 };
 * ```
 */
type Coordinates = { col: number; row: number };

/**
 * Builds the address of a cell from its zero-based column and row.
 *
 * @param col - Zero-based column.
 * @param row - Zero-based row.
 * @returns The address in the form `c<col>_<row>`.
 * @example
 * ```ts
 * const cell = toCellId(2, 3); // "c2_3"
 * ```
 */
function toCellId(col: number, row: number): CellId {
  return `c${col}_${row}`;
}

/**
 * Reads the column and row out of a cell address. An address that is not of the form
 * `c<col>_<row>` with two integers reads as `undefined`, so callers fall back instead of throwing.
 *
 * @param cell - The address to read.
 * @returns The column and row, or `undefined` when the address is not a cell.
 * @example
 * ```ts
 * const at = parseCell("c2_3"); // { col: 2, row: 3 }
 * ```
 */
function parseCell(cell: CellId): Coordinates | undefined {
  if (!cell.startsWith("c")) return undefined;

  const separator = cell.indexOf("_");
  if (separator === -1) return undefined;

  const colText = cell.slice(1, separator);
  const rowText = cell.slice(separator + 1);
  if (colText.length === 0 || rowText.length === 0) return undefined;

  const col = Number(colText);
  const row = Number(rowText);
  if (!Number.isInteger(col) || !Number.isInteger(row)) return undefined;

  return { col, row };
}

/**
 * Tells how far the farthest cell of the board lies from an origin, in Chebyshev distance.
 * A ring scan that reaches this distance has seen every cell of the board.
 *
 * @param board - The board that gives the size in columns and rows.
 * @param origin - The cell the rings grow around; it may lie outside the board.
 * @returns The largest Chebyshev distance a ring has to reach.
 * @example
 * ```ts
 * const rings = maxRingDistance(board, { col: 0, row: 0 });
 * ```
 */
function maxRingDistance(board: Board, origin: Coordinates): number {
  return Math.max(
    Math.abs(origin.col),
    Math.abs(origin.col - (board.cols - 1)),
    Math.abs(origin.row),
    Math.abs(origin.row - (board.rows - 1))
  );
}

/**
 * Lists the cells of one Chebyshev ring around an origin, row-major, clipped to the board.
 * Ring 0 is the origin itself, ring 1 the eight cells that touch it.
 *
 * @param board - The board that gives the size in columns and rows.
 * @param origin - The cell the ring grows around.
 * @param ring - The Chebyshev distance of the ring.
 * @returns The cells of the ring that lie on the board, in row-major order.
 * @example
 * ```ts
 * const around = ringCells(board, { col: 2, row: 2 }, 1);
 * ```
 */
function ringCells(board: Board, origin: Coordinates, ring: number): CellId[] {
  const cells: CellId[] = [];

  for (let row = origin.row - ring; row <= origin.row + ring; row++) {
    if (row < 0 || row >= board.rows) continue;

    for (let col = origin.col - ring; col <= origin.col + ring; col++) {
      if (col < 0 || col >= board.cols) continue;

      const onRing = Math.abs(row - origin.row) === ring || Math.abs(col - origin.col) === ring;
      if (onRing) cells.push(toCellId(col, row));
    }
  }

  return cells;
}

/**
 * Lists every cell of the board in row-major order, from the top-left.
 *
 * @param board - The board that gives the size in columns and rows.
 * @returns Every cell of the board, row by row.
 * @example
 * ```ts
 * const all = rowMajorCells({ cols: 2, rows: 1, items: [] }); // ["c0_0", "c1_0"]
 * ```
 */
function rowMajorCells(board: Board): CellId[] {
  const cells: CellId[] = [];

  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) cells.push(toCellId(col, row));
  }

  return cells;
}

/**
 * Collects the cells that already carry an item. Items in the inventory are not on the board,
 * so they never occupy a cell.
 *
 * @param board - The board to read.
 * @returns The set of occupied cell addresses.
 * @example
 * ```ts
 * const taken = occupiedCells(state.board);
 * ```
 */
function occupiedCells(board: Board, blocked: readonly CellId[] = []): Set<CellId> {
  return new Set([...board.items.map(item => item.cell), ...blocked]);
}

/**
 * Lists the cells that touch a cell on the board, in a fixed row-major order, without cells
 * outside the board. Touching means Chebyshev distance one: up to eight cells, diagonals included.
 *
 * @param board - The board that gives the size in columns and rows.
 * @param cell - The cell whose neighbours are listed.
 * @returns The neighbouring cells, row-major; an empty list when `cell` is not a cell address.
 * @example
 * ```ts
 * const around = neighbors(state.board, "c0_0"); // ["c1_0", "c0_1", "c1_1"]
 * ```
 */
export function neighbors(board: Board, cell: CellId): CellId[] {
  const origin = parseCell(cell);
  if (origin === undefined) return [];

  return ringCells(board, origin, 1);
}

/**
 * Finds a free cell on the board. The scan order is fixed, so the result is deterministic:
 * with `near` it walks the nearest Chebyshev ring first (ring 0 is `near` itself) and row-major
 * inside each ring; without `near`, or when `near` is not a cell address, it walks the whole
 * board row-major from the top-left. Items on the board occupy a cell, and so do the `blocked`
 * cells: a generator stands on one, and a drop must never cover it.
 *
 * @param board - The board to scan.
 * @param near - Optional cell to search around first; it may lie outside the board.
 * @param blocked - Cells that count as taken although no item stands there.
 * @returns The first free cell in scan order, or `undefined` when the board is full.
 * @example
 * ```ts
 * const cell = findFreeCell(state.board, "c3_4", ["c3_4"]);
 * if (cell === undefined) showBoardFull();
 * ```
 */
export function findFreeCell(
  board: Board,
  near?: CellId,
  blocked: readonly CellId[] = []
): CellId | undefined {
  const taken = occupiedCells(board, blocked);
  const origin = near === undefined ? undefined : parseCell(near);

  // No usable anchor: one plain row-major sweep from the top-left.
  if (origin === undefined) return rowMajorCells(board).find(cell => !taken.has(cell));

  // Anchored: nearest ring first, so a dropped item lands next to the generator that made it.
  const rings = maxRingDistance(board, origin);

  for (let ring = 0; ring <= rings; ring++) {
    const free = ringCells(board, origin, ring).find(cell => !taken.has(cell));
    if (free !== undefined) return free;
  }

  return undefined;
}

/**
 * Returns the item that stands on a cell, or `undefined` when the cell is empty.
 *
 * @param board - The board to read.
 * @param cell - The cell to look at.
 * @returns The item on that cell, or `undefined`.
 * @example
 * ```ts
 * const item = itemAt(state.board, "c2_1");
 * ```
 */
export function itemAt(board: Board, cell: CellId): Item | undefined {
  return board.items.find(item => item.cell === cell);
}

/**
 * Returns the item with an id, or `undefined` when no item on the board carries it.
 * The inventory is not searched: an item in a slot is not on the board.
 *
 * @param board - The board to read.
 * @param item - The id to look for.
 * @returns The item with that id, or `undefined`.
 * @example
 * ```ts
 * const found = itemById(state.board, "i17");
 * ```
 */
export function itemById(board: Board, item: ItemId): Item | undefined {
  return board.items.find(candidate => candidate.id === item);
}

/**
 * Returns a board without the item of an id. The input board is not mutated; an unknown id
 * gives an equal board back.
 *
 * @param board - The board to copy from.
 * @param item - The id of the item to drop.
 * @returns A new board without that item.
 * @example
 * ```ts
 * const board = withoutItem(state.board, "i17");
 * ```
 */
export function withoutItem(board: Board, item: ItemId): Board {
  return { ...board, items: board.items.filter(candidate => candidate.id !== item) };
}

/**
 * Returns a board with one more item, appended at the end. The input board is not mutated.
 *
 * @param board - The board to copy from.
 * @param item - The item to add.
 * @returns A new board with that item on it.
 * @example
 * ```ts
 * const board = withItem(state.board, { id: "i18", chain: "wood", level: 1, cell: "c0_1" });
 * ```
 */
export function withItem(board: Board, item: Item): Board {
  return { ...board, items: [...board.items, item] };
}

/**
 * Returns a board where the item of the same id is replaced, keeping its position in the list.
 * The input board is not mutated; an unknown id gives an equal board back.
 *
 * @param board - The board to copy from.
 * @param item - The replacement item; its `id` picks the item it replaces.
 * @returns A new board with the replacement in place.
 * @example
 * ```ts
 * const board = replaceItem(state.board, { ...target, level: target.level + 1 });
 * ```
 */
export function replaceItem(board: Board, item: Item): Board {
  return {
    ...board,
    items: board.items.map(candidate => (candidate.id === item.id ? item : candidate))
  };
}
