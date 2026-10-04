/**
 * @file ui/layout — the range of a windowed scroll: which rows exist, from the offset of the
 * content, the height of the viewport and a fixed row height. Pure arithmetic: no Yoga is asked
 * about the rows that do not exist.
 */

import type { RowRange } from "./types";

/**
 * The rows in view plus `overscan` on each side, clamped to the list.
 *
 * @param offset - Where the content is moved to, 0 or below.
 * @param viewportHeight - The height of the scroll container's rect.
 * @param rows - How many rows the list has.
 * @param rowHeight - The height of every row, above 0.
 * @param overscan - Rows kept alive beyond each edge of the viewport.
 * @returns The range of indexes.
 * @example
 * ```ts
 * windowOf(-3840, 1600, 1000, 120, 5); // { first: 27, last: 50 }
 * ```
 */
export function windowOf(
  offset: number,
  viewportHeight: number,
  rows: number,
  rowHeight: number,
  overscan: number
): RowRange {
  if (rows <= 0) return { first: 0, last: -1 };

  const top = -offset;
  const firstVisible = Math.floor(top / rowHeight);
  const lastVisible = Math.ceil((top + viewportHeight) / rowHeight) - 1;

  return {
    first: Math.min(rows - 1, Math.max(0, firstVisible - overscan)),
    last: Math.max(0, Math.min(rows - 1, lastVisible + overscan))
  };
}
