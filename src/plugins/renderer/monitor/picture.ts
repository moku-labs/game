/**
 * @file renderer/monitor — what `capture()` draws on a picture after the extract, on an
 * `OffscreenCanvas` 2D context the game never shows: the numbered badges of a legend, a contact
 * sheet of several frames, and the pixel diff against an earlier picture. The geometry and the
 * pixel compare are pure; the rest decodes, draws and encodes.
 */
import type { HitBox } from "../sync/types";
import type { Point } from "../types";
import type { LegendEntry, PictureRect, Pixels, SheetLayout } from "./types";

/** Size of the badge number in CSS pixels; the picture draws it times the resolution. */
const BADGE_FONT_PX = 12;

/** Padding around the badge number, in picture pixels. */
const BADGE_PADDING = 2;

/** The largest sheet width the cells are scaled down to, before the gutters. */
const SHEET_MAX_WIDTH = 2048;

/** Gap around and between the cells of a sheet, in picture pixels. */
const SHEET_GUTTER = 8;

/** Background of a sheet, shown in the gutters. */
const SHEET_BACKGROUND = "#202020";

/** The largest channel delta that still counts as the same pixel: the visual runner's default. */
const PIXEL_THRESHOLD = 24;

/** How much of the way to white a matching grey pixel keeps: `255 - (255 - grey) × 0.4`. */
const FADE_KEEP = 0.4;

/** Bytes of one pixel: red, green, blue and alpha. */
const CHANNELS = 4;

/** The alpha of a pixel no one sees through: every pixel of the diff picture. */
const OPAQUE = 255;

/** The value of a channel in white, where a matching pixel fades to. */
const WHITE = 255;

/** A pixel that differs, on the diff picture: opaque `#ff0000`. */
const DIFF_PIXEL = [255, 0, 0, OPAQUE] as const;

/** The Rec. 601 luma weights: how much red, green and blue make the grey of a pixel. */
const LUMA = { red: 0.299, green: 0.587, blue: 0.114 } as const;

/** Bytes encoded per `String.fromCodePoint` call, well under the argument limit of an engine. */
const ENCODE_CHUNK = 0x80_00;

/**
 * Builds the error of two pictures that cannot be compared.
 *
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * differentSizes().message.startsWith("[game] game.capture: the pictures differ in size."); // true
 * ```
 */
function differentSizes(): Error {
  return new Error(
    "[game] game.capture: the pictures differ in size.\n  Capture both at the same canvas size."
  );
}

/**
 * Brings a box in reference units onto the picture: both corners through `toScreen`, the canvas
 * origin taken off, times the resolution, rounded to whole pixels.
 *
 * @param box - The box in reference units.
 * @param toScreen - The viewport map from reference units to client CSS pixels.
 * @param origin - The top-left corner of the canvas on the page, in CSS pixels.
 * @param resolution - Picture pixels per CSS pixel.
 * @returns The rect in picture pixels.
 * @example
 * ```ts
 * pictureRect({ x: 570, y: 1155, width: 283.5, height: 82 }, point => point, { x: 0, y: 0 }, 2);
 * // { x: 1140, y: 2310, w: 567, h: 164 }
 * ```
 */
export function pictureRect(
  box: HitBox,
  toScreen: (point: Point) => Point,
  origin: Point,
  resolution: number
): PictureRect {
  const topLeft = toScreen({ x: box.x, y: box.y });
  const bottomRight = toScreen({ x: box.x + box.width, y: box.y + box.height });

  return {
    x: Math.round((topLeft.x - origin.x) * resolution),
    y: Math.round((topLeft.y - origin.y) * resolution),
    w: Math.round((bottomRight.x - topLeft.x) * resolution),
    h: Math.round((bottomRight.y - topLeft.y) * resolution)
  };
}

/**
 * Numbers the views of a legend: sorted by the top edge of their rect, then the left edge, and
 * numbered from 1 in that order.
 *
 * @param found - The views with their address and rect.
 * @returns The numbered entries, a fresh array.
 * @example
 * ```ts
 * numberLegend([{ projection: "hud", key: "claim", rect: { x: 1140, y: 2310, w: 567, h: 164 } }])[0]?.n; // 1
 * ```
 */
export function numberLegend(found: readonly Omit<LegendEntry, "n">[]): LegendEntry[] {
  return found
    .toSorted((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x)
    .map((entry, index) => ({ n: index + 1, ...entry }));
}

/**
 * Draws one badge: the label in white on a black box, its top-left corner at the point.
 *
 * @param context - The 2D context of the picture.
 * @param label - The text, a number.
 * @param at - The top-left corner, in picture pixels.
 * @param resolution - Picture pixels per CSS pixel; the label is 12 CSS pixels high.
 */
function drawBadge(
  context: OffscreenCanvasRenderingContext2D,
  label: string,
  at: Point,
  resolution: number
): void {
  const size = BADGE_FONT_PX * resolution;

  context.font = `${String(size)}px sans-serif`;
  context.textBaseline = "top";

  const width = context.measureText(label).width;

  context.fillStyle = "#000000";
  context.fillRect(at.x, at.y, width + 2 * BADGE_PADDING, size + 2 * BADGE_PADDING);
  context.fillStyle = "#ffffff";
  context.fillText(label, at.x + BADGE_PADDING, at.y + BADGE_PADDING);
}

/**
 * Draws the badge of every legend entry at the top-left corner of its rect, in legend order.
 *
 * @param context - The 2D context of the picture.
 * @param legend - The numbered entries.
 * @param resolution - Picture pixels per CSS pixel.
 */
export function drawLegend(
  context: OffscreenCanvasRenderingContext2D,
  legend: readonly LegendEntry[],
  resolution: number
): void {
  for (const entry of legend) drawBadge(context, String(entry.n), entry.rect, resolution);
}

/**
 * Lays a contact sheet out: `ceil(sqrt(frames))` columns, as many rows as needed, every cell the
 * picture scaled by `min(1, 2048 / (columns × width))` with its aspect kept, an 8 px gutter around
 * and between the cells, left to right and top to bottom.
 *
 * @param frames - How many pictures, 2 to 12.
 * @param width - Width of one picture, in pixels.
 * @param height - Height of one picture, in pixels.
 * @returns The grid, the scale, the size of the sheet and the rect of every cell.
 * @example
 * ```ts
 * sheetLayout(5, 400, 300).cells[3]; // { x: 8, y: 316, w: 400, h: 300 }
 * ```
 */
export function sheetLayout(frames: number, width: number, height: number): SheetLayout {
  const columns = Math.ceil(Math.sqrt(frames));
  const rows = Math.ceil(frames / columns);
  const scale = Math.min(1, SHEET_MAX_WIDTH / (columns * width));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const cells = Array.from({ length: frames }, (_, index) => ({
    x: SHEET_GUTTER + (index % columns) * (w + SHEET_GUTTER),
    y: SHEET_GUTTER + Math.floor(index / columns) * (h + SHEET_GUTTER),
    w,
    h
  }));

  return {
    columns,
    rows,
    scale,
    width: columns * w + (columns + 1) * SHEET_GUTTER,
    height: rows * h + (rows + 1) * SHEET_GUTTER,
    cells
  };
}

/**
 * One byte of a picture, 0 past its end.
 *
 * @param data - The RGBA bytes.
 * @param at - The index of the byte.
 * @returns The byte.
 * @example
 * ```ts
 * byteAt(new Uint8ClampedArray([10, 20, 30, 255]), 1); // 20
 * ```
 */
function byteAt(data: Uint8ClampedArray, at: number): number {
  return data[at] ?? 0;
}

/**
 * Tells whether two pixels differ: any RGBA channel by more than 24.
 *
 * @param current - The bytes of the current picture.
 * @param earlier - The bytes of the earlier picture.
 * @param at - The index of the pixel's first byte.
 * @returns True when the pixels differ.
 * @example
 * ```ts
 * pixelDiffers(new Uint8ClampedArray([125, 0, 0, 255]), new Uint8ClampedArray([100, 0, 0, 255]), 0); // true
 * ```
 */
function pixelDiffers(current: Uint8ClampedArray, earlier: Uint8ClampedArray, at: number): boolean {
  for (let channel = at; channel < at + CHANNELS; channel += 1) {
    if (Math.abs(byteAt(current, channel) - byteAt(earlier, channel)) > PIXEL_THRESHOLD)
      return true;
  }

  return false;
}

/**
 * The grey of a pixel: its red, green and blue by the luma weights.
 *
 * @param data - The RGBA bytes.
 * @param at - The index of the pixel's first byte.
 * @returns The grey, 0 to 255.
 * @example
 * ```ts
 * greyOf(new Uint8ClampedArray([10, 20, 30, 255]), 0); // 18.15
 * ```
 */
function greyOf(data: Uint8ClampedArray, at: number): number {
  return (
    LUMA.red * byteAt(data, at) +
    LUMA.green * byteAt(data, at + 1) +
    LUMA.blue * byteAt(data, at + 2)
  );
}

/**
 * Compares two pictures pixel by pixel into the diff picture: `#ff0000` where a pixel differs,
 * the current pixel faded elsewhere (its grey, then `255 - (255 - grey) × 0.4`), always opaque.
 *
 * @param current - The current picture.
 * @param earlier - The earlier picture.
 * @returns The RGBA bytes of the diff picture.
 * @throws {Error} When the two pictures differ in size.
 * @example
 * ```ts
 * const grey = { width: 1, height: 1, data: new Uint8ClampedArray([10, 20, 30, 255]) };
 * [...diffPixels(grey, grey)]; // [160, 160, 160, 255]
 * ```
 */
export function diffPixels(current: Pixels, earlier: Pixels): Uint8ClampedArray<ArrayBuffer> {
  if (current.width !== earlier.width || current.height !== earlier.height) {
    throw differentSizes();
  }

  const out = new Uint8ClampedArray(current.width * current.height * CHANNELS);
  const now = current.data;

  for (let at = 0; at < out.length; at += CHANNELS) {
    // A pixel that differs turns red. A pixel that stayed the same keeps its grey, faded toward
    // white, so the red is the one thing that stands out.
    if (pixelDiffers(now, earlier.data, at)) {
      out.set(DIFF_PIXEL, at);
      continue;
    }

    const faded = WHITE - (WHITE - greyOf(now, at)) * FADE_KEEP;

    out.set([faded, faded, faded, OPAQUE], at);
  }

  return out;
}

/**
 * Decodes a PNG data URL into a bitmap a 2D context draws.
 *
 * @param url - The `data:image/png;base64,…` URL.
 * @returns The bitmap.
 */
export async function decodePicture(url: string): Promise<ImageBitmap> {
  const binary = atob(url.slice(url.indexOf(",") + 1));
  const bytes = Uint8Array.from(binary, char => char.codePointAt(0) ?? 0);

  return createImageBitmap(new Blob([bytes], { type: "image/png" }));
}

/**
 * Encodes a canvas as a PNG data URL.
 *
 * @param canvas - The canvas.
 * @returns The `data:image/png;base64,…` URL.
 */
export async function encodePicture(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";

  for (let start = 0; start < bytes.length; start += ENCODE_CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(start, start + ENCODE_CHUNK));
  }

  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * Makes a canvas and its 2D context.
 *
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @returns The canvas and the context.
 * @throws {Error} When the browser gives no 2D context.
 */
function canvasOf(
  width: number,
  height: number
): { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error(
      "[game] game.capture got no 2D context from OffscreenCanvas.\n  Capture in a browser that draws 2D on an OffscreenCanvas."
    );
  }

  return { canvas, context };
}

/**
 * Draws the badges of a legend on a picture.
 *
 * @param png - The picture.
 * @param legend - The numbered entries, measured on the frame of the picture.
 * @param resolution - Picture pixels per CSS pixel.
 * @returns The PNG data URL of the numbered picture.
 */
export async function legendPicture(
  png: string,
  legend: readonly LegendEntry[],
  resolution: number
): Promise<string> {
  const bitmap = await decodePicture(png);
  const { canvas, context } = canvasOf(bitmap.width, bitmap.height);

  context.drawImage(bitmap, 0, 0);
  drawLegend(context, legend, resolution);

  return encodePicture(canvas);
}

/**
 * Lays several pictures of one canvas out on a contact sheet, each with its frame number. The
 * first picture gives the size of a cell.
 *
 * @param pictures - The PNG data URLs, in frame order.
 * @param resolution - Picture pixels per CSS pixel, for the badges.
 * @returns The PNG data URL of the sheet.
 */
export async function sheetPicture(
  pictures: readonly [string, ...string[]],
  resolution: number
): Promise<string> {
  const [head, ...tail] = pictures;
  const first = await decodePicture(head);
  const bitmaps = [first, ...(await Promise.all(tail.map(png => decodePicture(png))))];
  const layout = sheetLayout(bitmaps.length, first.width, first.height);
  const { canvas, context } = canvasOf(layout.width, layout.height);

  context.fillStyle = SHEET_BACKGROUND;
  context.fillRect(0, 0, layout.width, layout.height);

  for (const [index, bitmap] of bitmaps.entries()) {
    const cell = layout.cells[index];

    if (cell === undefined) continue;

    context.drawImage(bitmap, cell.x, cell.y, cell.w, cell.h);
    drawBadge(context, String(index + 1), cell, resolution);
  }

  return encodePicture(canvas);
}

/**
 * Reads the pixels of a bitmap through a canvas of its size.
 *
 * @param context - A 2D context as large as the bitmap.
 * @param bitmap - The bitmap.
 * @returns Its pixels.
 */
function pixelsOf(context: OffscreenCanvasRenderingContext2D, bitmap: ImageBitmap): Pixels {
  context.clearRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);

  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Draws the pixel diff of the current picture against an earlier one, and the badges of the
 * current frame's legend over it when there is one.
 *
 * @param png - The current picture.
 * @param against - The earlier picture.
 * @param legend - The legend of the current frame, or `undefined`.
 * @param resolution - Picture pixels per CSS pixel.
 * @returns The PNG data URL of the diff picture.
 * @throws {Error} When the two pictures differ in size.
 */
export async function diffPicture(
  png: string,
  against: string,
  legend: readonly LegendEntry[] | undefined,
  resolution: number
): Promise<string> {
  const [current, earlier] = await Promise.all([decodePicture(png), decodePicture(against)]);

  if (current.width !== earlier.width || current.height !== earlier.height) {
    throw differentSizes();
  }

  const { canvas, context } = canvasOf(current.width, current.height);
  const before = pixelsOf(context, earlier);
  const now = pixelsOf(context, current);

  context.putImageData(new ImageData(diffPixels(now, before), current.width, current.height), 0, 0);

  if (legend !== undefined) drawLegend(context, legend, resolution);

  return encodePicture(canvas);
}
