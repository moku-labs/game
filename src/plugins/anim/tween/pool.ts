/**
 * @file anim/tween — what the track table keeps for the next start instead of making it again (F244 В): the records
 * of the tracks the frame step dropped, by slot count; the one-number cells of the bases and offsets a released field
 * gave back; and the key strings of the fields, in a cache of fixed size. A rest move of 0 ms, started and ended every
 * turn of a page, so makes nothing once the table has run one turn.
 */
import type { Track } from "./types";

/** The part of the anim state that keeps the free records: `freeTracks[count]` is a stack. */
type TrackTable = { readonly freeTracks: Track[][] };

/**
 * Keeps a dropped track's record for the next start with as many slots. The frame step calls it for a track that left
 * the dense list, never in the step it ended: until then the list still holds it.
 *
 * @param table - The anim state, which the free records belong to.
 * @param track - The ended track, out of every table.
 */
export function releaseTrack(table: TrackTable, track: Track): void {
  const stacks = table.freeTracks;
  const count = track.names.length;

  // A stack per slot count, made by the first release of that count.
  while (stacks.length <= count) stacks.push([]);
  stacks[count]?.push(track);
}

/**
 * A free record of a track with this many slots, taken off its stack.
 *
 * @param table - The anim state.
 * @param count - The slot count of the track that starts.
 * @returns The record, or `undefined` when none is free.
 */
export function takeTrack(table: TrackTable, count: number): Track | undefined {
  return table.freeTracks[count]?.pop();
}

/** The one-number cells the bases and offsets gave back. */
const cells: Float64Array[] = [];

/**
 * A one-number cell holding `value`: one given back if there is one, else a new one.
 *
 * @param value - What it holds.
 * @returns The cell.
 */
export function takeCell(value: number): Float64Array {
  const cell = cells.pop() ?? new Float64Array(1);

  cell[0] = value;

  return cell;
}

/**
 * Gives a cell back once no table holds it.
 *
 * @param cell - The cell of a base or an offset that was just deleted.
 */
export function releaseCell(cell: Float64Array): void {
  cells.push(cell);
}

/** How many key strings the cache keeps: a power of two, so a slot is a mask away. */
const KEY_SLOTS = 1024;

/** The mask of a slot index. */
const KEY_MASK = KEY_SLOTS - 1;

/** Per slot, the entity of the kept key; `-1` for none. */
const keyEntities = new Float64Array(KEY_SLOTS).fill(-1);

/** Per slot, the component name of the kept key. */
const keyComponents: string[] = Array.from({ length: KEY_SLOTS }, () => "");

/** Per slot, the field of the kept key. */
const keyFields: string[] = Array.from({ length: KEY_SLOTS }, () => "");

/** Per slot, the kept key. */
const keyStrings: string[] = Array.from({ length: KEY_SLOTS }, () => "");

/**
 * The slot of a key in the cache: the low bits of the entity, mixed with the field's length and first letter and the
 * component's. Small whole numbers only, so nothing is boxed outside the optimizing tiers.
 *
 * @param entity - The entity.
 * @param component - Component name.
 * @param field - Field name.
 * @returns The slot, 0 to 1023.
 * @example
 * ```ts
 * keySlot(5, "Transform", "x"); // 763
 * ```
 */
function keySlot(entity: number, component: string, field: string): number {
  return (
    ((entity & KEY_MASK) * 7 +
      field.length * 131 +
      (field.codePointAt(0) ?? 0) * 3 +
      component.length * 17 +
      (component.codePointAt(0) ?? 0)) &
    KEY_MASK
  );
}

/**
 * The key one field of one component of one entity is booked under, `${entity}:${component}:${field}`, from the
 * cache when the same three asked last in its slot, else built and kept there.
 *
 * @param entity - The entity.
 * @param component - Component name.
 * @param field - Field name.
 * @returns The key.
 * @example
 * ```ts
 * keyFor(1_048_576, "Transform", "x"); // "1048576:Transform:x"
 * ```
 */
export function keyFor(entity: number, component: string, field: string): string {
  const slot = keySlot(entity, component, field);

  if (
    keyEntities[slot] === entity &&
    keyFields[slot] === field &&
    keyComponents[slot] === component
  ) {
    return keyStrings[slot] ?? "";
  }

  const key = `${entity}:${component}:${field}`;

  keyEntities[slot] = entity;
  keyComponents[slot] = component;
  keyFields[slot] = field;
  keyStrings[slot] = key;

  return key;
}
