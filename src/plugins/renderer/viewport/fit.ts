/**
 * @file renderer/viewport — the pure geometry: the largest allowed rectangle inside the canvas,
 * the scale to reference units and the reference size of that rectangle.
 */
import type { AspectRange } from "../types";
import type { Orientation, Rect, SafeArea } from "./types";

const EMPTY: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Keeps a number inside a range.
 *
 * @param value - The number.
 * @param min - Lower bound.
 * @param max - Upper bound.
 * @returns The bounded number.
 * @example
 * ```ts
 * clamp(0.5625, 1.3333, 2.3333); // 1.3333
 * ```
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The largest centred rectangle inside the canvas whose long / short ratio, measured in the
 * designed orientation, is inside the allowed range. What is left over becomes the bars.
 *
 * @param canvas - Size of the canvas in CSS pixels.
 * @param canvas.width - CSS width of the canvas.
 * @param canvas.height - CSS height of the canvas.
 * @param aspect - Allowed long side / short side.
 * @param orientation - The orientation the game is designed for.
 * @returns The frame inside the canvas.
 * @example
 * ```ts
 * fitFrame({ width: 1920, height: 1080 }, { min: 4 / 3, max: 21 / 9 }, "portrait");
 * // { x: 555, y: 0, width: 810, height: 1080 }
 * ```
 */
export function fitFrame(
  canvas: { width: number; height: number },
  aspect: AspectRange,
  orientation: Orientation
): Rect {
  if (canvas.width <= 0 || canvas.height <= 0) return { ...EMPTY };

  const portrait = orientation === "portrait";
  const short = portrait ? canvas.width : canvas.height;
  const long = portrait ? canvas.height : canvas.width;
  const ratio = long / short;
  const wanted = clamp(ratio, aspect.min, aspect.max);
  const frameShort = ratio < wanted ? long / wanted : short;
  const frameLong = ratio > wanted ? short * wanted : long;
  const width = portrait ? frameShort : frameLong;
  const height = portrait ? frameLong : frameShort;

  return { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height };
}

/**
 * CSS pixels per reference unit. Both sides fit: the short side of the frame, in the designed
 * orientation, holds `referenceSide`, and the long side between its safe insets holds
 * `referenceLong`. The smaller of the two scales wins, so on a wide screen the reference short side
 * grows above `referenceSide`.
 *
 * @param frame - The drawn rectangle.
 * @param orientation - The orientation the game is designed for.
 * @param referenceSide - Short side of the reference resolution.
 * @param referenceLong - Long side the layout needs inside the safe area; 0 fits the short side
 *   alone.
 * @param safe - The insets that cover the frame, in CSS pixels: top and bottom are read for a
 *   portrait game, left and right for a landscape one.
 * @returns The scale. An empty frame answers 1, so nothing ever divides by zero.
 * @example
 * ```ts
 * const none = { top: 0, right: 0, bottom: 0, left: 0 };
 * scaleOf({ x: 0, y: 0, width: 390, height: 844 }, "portrait", 1080, 1920, none); // 0.3611, the width wins
 * scaleOf({ x: 0, y: 0, width: 768, height: 1024 }, "portrait", 1080, 1920, none); // 0.5333, the height wins
 * ```
 */
export function scaleOf(
  frame: Rect,
  orientation: Orientation,
  referenceSide: number,
  referenceLong: number,
  safe: SafeArea
): number {
  const portrait = orientation === "portrait";
  const short = portrait ? frame.width : frame.height;

  if (short <= 0 || referenceSide <= 0) return 1;

  const byShort = short / referenceSide;
  const long = portrait
    ? frame.height - safe.top - safe.bottom
    : frame.width - safe.left - safe.right;

  if (referenceLong <= 0 || long <= 0) return byShort;

  return Math.min(byShort, long / referenceLong);
}

/**
 * The frame in reference units: the short side is at least `referenceSide`, the long side inside
 * the safe area at least `referenceLong`.
 *
 * @param frame - The drawn rectangle in CSS pixels.
 * @param scale - CSS pixels per reference unit.
 * @returns The same rectangle in reference units.
 * @example
 * ```ts
 * referenceOf({ x: 555, y: 0, width: 810, height: 1080 }, 0.5625); // { width: 1440, height: 1920 }
 * ```
 */
export function referenceOf(frame: Rect, scale: number): { width: number; height: number } {
  if (scale <= 0) return { width: 0, height: 0 };

  return { width: frame.width / scale, height: frame.height / scale };
}
