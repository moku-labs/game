/**
 * @file renderer/monitor — the byte and rounding helpers the counters and the performance log share (LEAD-FIXES-3
 * O24), and the column readers: one per typed-array kind, never one shared. V8 keeps one load feedback per function,
 * inlined copies included: a reader that saw more than four array kinds goes generic, and every double it reads on the
 * per-frame path comes back boxed, a heap number a read. A reader that sees one kind stays monomorphic and reads the
 * double unboxed. The parameter type holds the rule: `cellF32` takes a `Float32Array` and nothing else. One read out of
 * bounds (slot -1) boxes a reader's doubles the same way, for every caller: a slot that may not exist is checked first.
 */

/** Bytes of one MiB. */
export const BYTES_PER_MB = 1024 * 1024;

/**
 * Rounds a number to a fixed count of decimals, so a counter reads well in a panel and a log line stays short.
 *
 * @param value - The number.
 * @param decimals - Decimals to keep.
 * @returns The rounded number.
 * @example
 * ```ts
 * roundTo(3.456_78, 2); // 3.46
 * ```
 */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

/**
 * Reads one value of a `Float64Array` column; a slot past the end reads NaN, "not measured".
 *
 * @param column - The column.
 * @param index - The slot.
 * @returns The value.
 * @example
 * ```ts
 * cellF64(Float64Array.of(2.5), 0); // 2.5
 * ```
 */
export function cellF64(column: Float64Array, index: number): number {
  return column[index] ?? Number.NaN;
}

/**
 * Reads one value of a `Float32Array` column; a slot past the end reads NaN, "not measured".
 *
 * @param column - The column.
 * @param index - The slot.
 * @returns The value.
 * @example
 * ```ts
 * cellF32(Float32Array.of(2.5), 1); // NaN
 * ```
 */
export function cellF32(column: Float32Array, index: number): number {
  return column[index] ?? Number.NaN;
}

/**
 * Reads one value of a `Uint32Array` column; a slot past the end reads NaN.
 *
 * @param column - The column.
 * @param index - The slot.
 * @returns The value.
 * @example
 * ```ts
 * cellU32(Uint32Array.of(4812), 0); // 4812
 * ```
 */
export function cellU32(column: Uint32Array, index: number): number {
  return column[index] ?? Number.NaN;
}

/**
 * Reads one value of an `Int32Array` column; a slot past the end reads NaN.
 *
 * @param column - The column.
 * @param index - The slot.
 * @returns The value.
 * @example
 * ```ts
 * cellI32(Int32Array.of(-1), 0); // -1
 * ```
 */
export function cellI32(column: Int32Array, index: number): number {
  return column[index] ?? Number.NaN;
}

/**
 * Reads one value of a `Uint16Array` column; a slot past the end reads NaN.
 *
 * @param column - The column.
 * @param index - The slot.
 * @returns The value.
 * @example
 * ```ts
 * cellU16(Uint16Array.of(0xff_ff), 0); // 65535
 * ```
 */
export function cellU16(column: Uint16Array, index: number): number {
  return column[index] ?? Number.NaN;
}

/**
 * Reads one value of a `Uint8Array` column; a slot past the end reads NaN.
 *
 * @param column - The column.
 * @param index - The slot.
 * @returns The value.
 * @example
 * ```ts
 * cellU8(Uint8Array.of(1), 0); // 1
 * ```
 */
export function cellU8(column: Uint8Array, index: number): number {
  return column[index] ?? Number.NaN;
}
