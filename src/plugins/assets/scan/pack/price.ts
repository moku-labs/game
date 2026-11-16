/**
 * @file assets packer, build time — what a texture costs the phone in GL memory (F198). Pure over
 * sizes: `chooseLayout` prices the layouts of a group with it, and the cache key carries the table.
 */

/** Bytes of one MiB. */
const BYTES_PER_MIB = 1_048_576;

/** Bytes of one RGBA pixel. */
const BYTES_PER_PIXEL = 4;

/**
 * Measured points of the price: MiB of RGBA pixels of one texture, and the GL MiB the phone pays for
 * it. A table, not a formula: Dawn sub-allocates a texture under 4 MiB in a power-of-two heap, so the
 * price jumps where a size crosses one (4 MiB to 4.05 MiB costs 1.27 GL MiB more).
 */
export const PRICE_POINTS: readonly (readonly [number, number])[] = [
  [0.0625, 0.0945],
  [0.25, 0.644],
  [1, 2.34],
  [1.373, 2.37],
  [2, 4.34],
  [2.44, 4.46],
  [4, 5.03],
  [4.05, 6.3],
  [5.49, 7.82],
  [8, 11.44],
  [16, 21.7]
];

/**
 * Counts the MiB of RGBA pixels of an image.
 *
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @returns `width × height × 4 / 1 048 576`.
 * @example
 * ```ts
 * pixelMb(1024, 1024); // 4
 * ```
 */
export function pixelMb(width: number, height: number): number {
  return (width * height * BYTES_PER_PIXEL) / BYTES_PER_MIB;
}

/**
 * Prices one texture: the GL MiB the phone pays for a texture of `pixelMb` MiB of RGBA pixels. Measured
 * on a Mali-G68 / Dawn phone (A26, F198): Dawn sub-allocates textures under 4 MiB in power-of-two
 * heaps, so a page just over a power of two costs far more than one just under it. Linear between the
 * measured points, proportional above the last (`× 21.7 / 16`) and below the first
 * (`× 0.0945 / 0.0625`). Every page is still cropped to its content, so the price is read on the page
 * as it is written.
 *
 * @param mib - MiB of RGBA pixels of the texture.
 * @returns GL MiB.
 * @example
 * ```ts
 * glMb(4); // 5.03
 * glMb(32); // 43.4
 * ```
 */
export function glMb(mib: number): number {
  const first = PRICE_POINTS[0];
  const last = PRICE_POINTS.at(-1);

  if (first === undefined || last === undefined) return 0;
  if (mib <= first[0]) return (mib * first[1]) / first[0];
  if (mib >= last[0]) return (mib * last[1]) / last[0];

  const upper = PRICE_POINTS.findIndex(point => point[0] >= mib);
  const high = PRICE_POINTS[upper];
  const low = PRICE_POINTS[upper - 1];

  if (high === undefined || low === undefined) return 0;

  return low[1] + ((mib - low[0]) / (high[0] - low[0])) * (high[1] - low[1]);
}
