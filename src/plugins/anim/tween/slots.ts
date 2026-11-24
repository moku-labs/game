/**
 * @file anim/tween — the typed arrays one track keeps per slot, cut as views of ONE buffer, so
 * starting a track makes one `ArrayBuffer` and not nine.
 */

/** The nine typed arrays of a track, by name; every one is a view of the same buffer. */
export type SlotCells = {
  /** `[0]`: the milliseconds the track ran; `[1]`: the normalised time of the write that runs. */
  clock: Float64Array;
  /** The target of each slot. */
  targets: Float64Array;
  /** The start value of each slot. */
  starts: Float64Array;
  /** `1` while the track drives the slot. */
  live: Uint8Array;
  /** `1` for a slot the running frame moved. */
  moved: Uint8Array;
  /** The numbers of the write that runs, by slot. */
  values: Float64Array;
  /** `1` for a colour slot. */
  colors: Uint8Array;
  /** The value last left in the field, `NaN` while unknown. */
  seen: Float64Array;
  /** The `moved` flags of the kept partial patch. */
  partialMoved: Uint8Array;
};

/** Bytes of one double. */
const DOUBLE = 8;

/** The cells of the clock: running time and normalised time. */
const CLOCK_CELLS = 2;

/** How many arrays of doubles follow the clock (`targets`, `starts`, `values`, `seen`). */
const DOUBLE_ARRAYS = 4;

/** How many arrays of bytes follow the doubles (`live`, `moved`, `colors`, `partialMoved`). */
const BYTE_ARRAYS = 4;

/**
 * Cuts the nine typed arrays of a track out of one buffer: the arrays of doubles first, so each
 * starts on an aligned offset, then the arrays of bytes. `live` starts at 1 and `seen` at `NaN`,
 * the rest at 0.
 *
 * @param count - How many slots the track has.
 * @returns The nine views, all over the same `ArrayBuffer`.
 * @example
 * ```ts
 * const cells = slotCellsOf(2);
 * cells.targets.buffer === cells.live.buffer; // true
 * cells.targets.length; // 2
 * ```
 */
export function slotCellsOf(count: number): SlotCells {
  const doubleBytes = (CLOCK_CELLS + DOUBLE_ARRAYS * count) * DOUBLE;
  const buffer = new ArrayBuffer(doubleBytes + BYTE_ARRAYS * count);
  const step = count * DOUBLE;
  const live = new Uint8Array(buffer, doubleBytes, count).fill(1);
  const targetsAt = CLOCK_CELLS * DOUBLE;
  const startsAt = targetsAt + step;
  const valuesAt = startsAt + step;
  const seenAt = valuesAt + step;
  const movedAt = doubleBytes + count;
  const colorsAt = movedAt + count;
  const partialAt = colorsAt + count;
  const seen = new Float64Array(buffer, seenAt, count).fill(Number.NaN);

  return {
    clock: new Float64Array(buffer, 0, CLOCK_CELLS),
    targets: new Float64Array(buffer, targetsAt, count),
    starts: new Float64Array(buffer, startsAt, count),
    values: new Float64Array(buffer, valuesAt, count),
    seen,
    live,
    moved: new Uint8Array(buffer, movedAt, count),
    colors: new Uint8Array(buffer, colorsAt, count),
    partialMoved: new Uint8Array(buffer, partialAt, count)
  };
}
