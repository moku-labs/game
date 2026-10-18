/**
 * @file anim/tween — the numbers the track table rewrites every frame, kept in `Float64Array`
 * cells: a base per field and an offset per additive track. A double stored in a `Map` or in an
 * object field is a new heap number at every store; a typed array is written in place, so a
 * running frame allocates nothing here.
 */
import type { AnimCtx } from "../types";

/** The running sum of `sumOffsets`: a cell, so neither the sum nor its callback allocates. */
const SUM = new Float64Array(1);

/**
 * The value of a one-number cell.
 *
 * @param cell - The cell.
 * @returns What it holds.
 * @example
 * ```ts
 * cellValue(Float64Array.of(0.5)); // 0.5
 * ```
 */
export function cellValue(cell: Float64Array): number {
  return cell[0] ?? 0;
}

/**
 * Creates a one-number cell.
 *
 * @param value - What it holds.
 * @returns The cell.
 */
function cellOf(value: number): Float64Array {
  const cell = new Float64Array(1);

  cell[0] = value;

  return cell;
}

/**
 * The base of one field, or a fallback when no track keeps one.
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 * @param fallback - What a field without a base reads.
 * @returns The base, or `fallback`.
 */
export function baseOr(actx: AnimCtx, key: string, fallback: number): number {
  const cell = actx.state.bases.get(key);

  return cell === undefined ? fallback : cellValue(cell);
}

/**
 * Writes the base of one field, in place when the field has one.
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 * @param value - The new base.
 */
export function setBase(actx: AnimCtx, key: string, value: number): void {
  const cell = actx.state.bases.get(key);

  if (cell === undefined) actx.state.bases.set(key, cellOf(value));
  else cell[0] = value;
}

/**
 * Creates the offsets table of one field. It lives in its own function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty table of track id to its offset cell.
 */
function emptyOffsets(): Map<number, Float64Array> {
  return new Map();
}

/**
 * Writes what one additive track adds to one field, in place after its first write.
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 * @param id - The id of the additive track.
 * @param delta - What the track adds now.
 */
export function setOffset(actx: AnimCtx, key: string, id: number, delta: number): void {
  let offsets = actx.state.offsets.get(key);

  if (offsets === undefined) {
    offsets = emptyOffsets();
    actx.state.offsets.set(key, offsets);
  }

  const cell = offsets.get(id);

  if (cell === undefined) offsets.set(id, cellOf(delta));
  else cell[0] = delta;
}

/**
 * Adds one offset cell to `SUM`.
 *
 * @param cell - What one additive track adds to the field.
 */
function addToSum(cell: Float64Array): void {
  SUM[0] = cellValue(SUM) + cellValue(cell);
}

/**
 * The sum of what every additive track contributes to one field.
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 * @returns The sum, `0` when no additive track drives the field.
 */
export function sumOffsets(actx: AnimCtx, key: string): number {
  const offsets = actx.state.offsets.get(key);

  if (offsets === undefined) return 0;

  SUM[0] = 0;
  // per frame: `forEach` over a module-level callback; a `for…of` over a Map makes an iterator.
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, on the hot path
  offsets.forEach(addToSum);

  return cellValue(SUM);
}
