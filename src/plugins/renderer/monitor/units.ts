/**
 * @file renderer/monitor — the byte and rounding helpers the counters and the performance log share (LEAD-FIXES-3 O24).
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
 * Reads one value of a column; a slot past the end reads NaN, "not measured". The one place a typed-array read meets
 * `noUncheckedIndexedAccess`.
 *
 * @param column - A typed array or any list of numbers.
 * @param index - The slot.
 * @returns The value.
 * @example
 * ```ts
 * cell(Float32Array.of(2.5), 0); // 2.5
 * ```
 */
export function cell(column: ArrayLike<number>, index: number): number {
  return column[index] ?? Number.NaN;
}
