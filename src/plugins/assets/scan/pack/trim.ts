/**
 * @file assets packer, build time — the transparent margins of a texture (F198). Pure over pixels:
 * `trimBox` finds what is visible, `cropPixels` cuts it out. A page holds the cut; the manifest keeps
 * where it lay in the original, so the sprite keeps its size and its place.
 */
import type { Pixels } from "./encode";

/** Transparent pixels kept around the visible ones where the image has them. */
export const TRIM_MARGIN = 1;

/** Bytes per pixel of the decoded images: RGBA. */
const CHANNELS = 4;

/** Which byte of a pixel is its alpha. */
const ALPHA_OFFSET = 3;

/** A rectangle of an image, in its pixels. */
export type Box = { x: number; y: number; width: number; height: number };

/** The first and the last column and row that hold a visible pixel. */
type Extent = { left: number; top: number; right: number; bottom: number };

/**
 * Finds the first and the last column and row with a pixel of alpha above 0.
 *
 * @param pixels - The decoded image.
 * @returns The extent, or `undefined` for an image with nothing visible.
 */
function visibleExtent(pixels: Pixels): Extent | undefined {
  const { width, height, data } = pixels;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if ((data[(row * width + column) * CHANNELS + ALPHA_OFFSET] ?? 0) === 0) continue;

      left = Math.min(left, column);
      right = Math.max(right, column);
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
    }
  }

  return right < 0 ? undefined : { left, top, right, bottom };
}

/**
 * Finds the box of the visible pixels of an image: every pixel with alpha above 0, grown by
 * `TRIM_MARGIN` on each side where the image has room. The margin keeps one transparent row or
 * column at a cut edge, so bilinear sampling at the edge of the sprite and the 1 px edge copy of the
 * page read transparent there, as the uncut image did.
 *
 * @param pixels - The decoded image.
 * @returns The box in the pixels of the image: the whole image when it has no transparent margin,
 *   `{ x: 0, y: 0, width: 1, height: 1 }` when nothing is visible.
 * @example
 * ```ts
 * // A 6×4 image with one opaque pixel at (3, 2): the box is that pixel and its margin.
 * const data = new Uint8Array(6 * 4 * 4);
 * data[(2 * 6 + 3) * 4 + 3] = 255;
 * trimBox({ width: 6, height: 4, data }); // { x: 2, y: 1, width: 3, height: 3 }
 * ```
 */
export function trimBox(pixels: Pixels): Box {
  const extent = visibleExtent(pixels);

  if (extent === undefined) return { x: 0, y: 0, width: 1, height: 1 };

  const left = Math.max(0, extent.left - TRIM_MARGIN);
  const top = Math.max(0, extent.top - TRIM_MARGIN);
  const right = Math.min(pixels.width - 1, extent.right + TRIM_MARGIN);
  const bottom = Math.min(pixels.height - 1, extent.bottom + TRIM_MARGIN);

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Cuts a box out of an image.
 *
 * @param pixels - The decoded image.
 * @param box - The box to keep, inside the image.
 * @returns A new image of the box: the rows of the box, copied.
 * @example
 * ```ts
 * const data = Uint8Array.from({ length: 3 * 3 * 4 }, (_, index) => index);
 * cropPixels({ width: 3, height: 3, data }, { x: 1, y: 1, width: 1, height: 2 }).data;
 * // Uint8Array [16, 17, 18, 19, 28, 29, 30, 31]
 * ```
 */
export function cropPixels(pixels: Pixels, box: Box): Pixels {
  const rowBytes = box.width * CHANNELS;
  const data = new Uint8Array(rowBytes * box.height);

  for (let row = 0; row < box.height; row += 1) {
    const from = ((box.y + row) * pixels.width + box.x) * CHANNELS;

    data.set(pixels.data.subarray(from, from + rowBytes), row * rowBytes);
  }

  return { width: box.width, height: box.height, data };
}
