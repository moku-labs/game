/**
 * @file anim/tween — the numbers the track table rewrites every frame, kept in `Float64Array`
 * cells: a base per field and an offset per additive track. A double stored in a `Map` or in an
 * object field is a new heap number at every store; a typed array is written in place, so a
 * running frame allocates nothing here.
 */
import type { AnimCtx } from "../types";
import { takeCell } from "./pool";

/** `[1]` of a base cell while the field has a base. */
const PRESENT = 1;

/** `[1]` of a base cell the field let go; the cell stays in its table for the next track. */
const ABSENT = 0;

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
 * The base of one field, or a fallback when no track keeps one.
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 * @param fallback - What a field without a base reads.
 * @returns The base, or `fallback`.
 */
export function baseOr(actx: AnimCtx, key: string, fallback: number): number {
  const cell = baseOf(actx, key);

  return cell === undefined ? fallback : cellValue(cell);
}

/**
 * The cell of the base of one field, while the field has one. A base let go keeps its entry and its cell, marked
 * absent in `[1]`, so the next track of the field writes it again without a new entry in the table (F244 В).
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 * @returns The cell, `[0]` the base, or `undefined` when the field has no base.
 */
export function baseOf(actx: AnimCtx, key: string): Float64Array | undefined {
  const cell = actx.state.bases.get(key);

  return cell !== undefined && cell[1] === PRESENT ? cell : undefined;
}

/**
 * Writes the base of one field, in place when the field has one or had one.
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 * @param value - The new base.
 */
export function setBase(actx: AnimCtx, key: string, value: number): void {
  const cell = actx.state.bases.get(key);

  if (cell === undefined) {
    actx.state.bases.set(key, Float64Array.of(value, PRESENT));

    return;
  }

  if (cell[1] === ABSENT) countAbsent(actx, BASES, -1);
  cell[0] = value;
  cell[1] = PRESENT;
}

/**
 * Lets the base of one field go: its entry stays, marked absent, for the next track of the field. The frame step drops
 * the absent entries once there are many (`pruneAbsent`): a field of an entity that is gone is never written again.
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 */
export function deleteBase(actx: AnimCtx, key: string): void {
  const cell = actx.state.bases.get(key);

  if (cell === undefined || cell[1] === ABSENT) return;

  cell[1] = ABSENT;
  countAbsent(actx, BASES, 1);
}

/**
 * The track that owns one field now, by id; `undefined` while none does. A field let go keeps its entry at id 0, so
 * the next owner writes it again without a new entry in the table (F244 В).
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 * @returns The id of the owner, or `undefined`.
 */
export function ownerOf(actx: AnimCtx, key: string): number | undefined {
  const id = actx.state.owner.get(key);

  return id === 0 ? undefined : id;
}

/**
 * Books a field to the track that takes it.
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 * @param id - The id of the track.
 */
export function claimOwner(actx: AnimCtx, key: string, id: number): void {
  if (actx.state.owner.get(key) === 0) countAbsent(actx, OWNERS, -1);
  actx.state.owner.set(key, id);
}

/**
 * Lets a field go: no track owns it any more. Its entry stays at id 0 until the frame step drops the idle entries.
 *
 * @param actx - Domain context of the anim plugin.
 * @param key - The field key.
 */
export function releaseOwner(actx: AnimCtx, key: string): void {
  actx.state.owner.set(key, 0);
  countAbsent(actx, OWNERS, 1);
}

/** How many absent entries a table may keep before the frame step drops them. */
const ABSENT_LIMIT = 512;

/** The cell of the count of absent bases. */
const BASES = 0;

/** The cell of the count of idle owner entries. */
const OWNERS = 1;

/**
 * Moves one count of the absent entries of the table (`state.absent`).
 *
 * @param actx - Domain context of the anim plugin.
 * @param at - `BASES` or `OWNERS`.
 * @param delta - `1` for an entry let go, `-1` for one written again.
 */
function countAbsent(actx: AnimCtx, at: number, delta: number): void {
  const count = actx.state.absent;

  count[at] = (count[at] ?? 0) + delta;
}

/** The tables the two callbacks below delete from, set for one walk. */
const pruning: {
  bases: Map<string, Float64Array> | undefined;
  owner: Map<string, number> | undefined;
} = { bases: undefined, owner: undefined };

/**
 * Deletes one entry of the bases when its base was let go.
 *
 * @param cell - The cell.
 * @param key - The field key.
 */
function dropAbsentBase(cell: Float64Array, key: string): void {
  if (cell[1] === ABSENT) pruning.bases?.delete(key);
}

/**
 * Deletes one entry of the owners when no track owns its field.
 *
 * @param id - The owner id, 0 for none.
 * @param key - The field key.
 */
function dropIdleOwner(id: number, key: string): void {
  if (id === 0) pruning.owner?.delete(key);
}

/**
 * Drops the absent bases and the idle owner entries once a table keeps 512 of either: the fields of entities that are
 * gone. A table whose fields come back turn after turn stays under it and is never walked.
 *
 * @param actx - Domain context of the anim plugin.
 */
export function pruneAbsent(actx: AnimCtx): void {
  const count = actx.state.absent;

  if ((count[BASES] ?? 0) >= ABSENT_LIMIT) {
    pruning.bases = actx.state.bases;
    // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, by a module-level callback
    actx.state.bases.forEach(dropAbsentBase);
    pruning.bases = undefined;
    count[BASES] = 0;
  }

  if ((count[OWNERS] ?? 0) >= ABSENT_LIMIT) {
    pruning.owner = actx.state.owner;
    // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, by a module-level callback
    actx.state.owner.forEach(dropIdleOwner);
    pruning.owner = undefined;
    count[OWNERS] = 0;
  }
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

  if (cell === undefined) offsets.set(id, takeCell(actx.state, delta));
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
