import { describe, expect, it } from "vitest";
import { composePage, type PagePart } from "../../scan/pack/encode";
import { EXTRUDE, PADDING } from "../../scan/pack/layout";

// ---------------------------------------------------------------------------
// Unit test (F105): a frame's edge pixels are copied out into its padding, so a picture drawn at a fractional place
// samples its own edge, never the page's clear padding (the tutorial veil's outline and ticks on the A26).
// ---------------------------------------------------------------------------

/** Bytes per pixel. */
const CHANNELS = 4;

/**
 * A solid frame of one colour.
 *
 * @param width - Width.
 * @param height - Height.
 * @param colour - RGBA.
 * @param at - Its place on the page.
 * @param at.x - Left.
 * @param at.y - Top.
 * @returns The part.
 */
function solid(
  width: number,
  height: number,
  colour: readonly number[],
  at: { x: number; y: number }
): PagePart {
  const data = new Uint8Array(width * height * CHANNELS);

  for (let pixel = 0; pixel < width * height; pixel += 1) data.set(colour, pixel * CHANNELS);

  return { pixels: { width, height, data }, x: at.x, y: at.y };
}

/**
 * The RGBA of one page pixel.
 *
 * @param page - The pixels.
 * @param width - Page width.
 * @param x - Column.
 * @param y - Row.
 * @returns The four channels.
 */
function at(page: Uint8Array, width: number, x: number, y: number): number[] {
  return [...page.subarray((y * width + x) * CHANNELS, (y * width + x + 1) * CHANNELS)];
}

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

describe("composePage", () => {
  // Bug: the padding around a frame stays clear, so bilinear sampling at a fractional place blends the frame's edge
  // with transparent black: a faint outline round a packed picture.
  it("copies a frame's edge pixels one pixel out on every side, corners included", () => {
    const page = composePage(8, 8, [solid(2, 2, RED, { x: 3, y: 3 })]);

    expect(at(page, 8, 2, 3)).toEqual(RED);
    expect(at(page, 8, 5, 4)).toEqual(RED);
    expect(at(page, 8, 3, 2)).toEqual(RED);
    expect(at(page, 8, 4, 5)).toEqual(RED);
    expect(at(page, 8, 2, 2)).toEqual(RED);
    expect(at(page, 8, 5, 5)).toEqual(RED);
    // Beyond the extruded pixel the page stays clear.
    expect(at(page, 8, 1, 3)).toEqual(CLEAR);
    expect(at(page, 8, 3, 6)).toEqual(CLEAR);
  });

  // Bug: the extruded edge of one frame overwrites its neighbour's own pixels or its neighbour's edge copy.
  it("keeps two neighbours apart: each fills its side of the padding between them", () => {
    expect(PADDING).toBeGreaterThanOrEqual(2 * EXTRUDE);

    const page = composePage(10, 4, [
      solid(2, 2, RED, { x: 1, y: 1 }),
      solid(2, 2, BLUE, { x: 1 + 2 + PADDING, y: 1 })
    ]);

    expect(at(page, 10, 2, 1)).toEqual(RED);
    expect(at(page, 10, 3, 1)).toEqual(RED);
    expect(at(page, 10, 4, 1)).toEqual(BLUE);
    expect(at(page, 10, 5, 1)).toEqual(BLUE);
  });

  // Bug: a frame against the page's edge writes outside the page buffer (a row of the next line, or a throw).
  it("skips the extruded pixels that fall outside the page", () => {
    const page = composePage(3, 3, [solid(2, 2, RED, { x: 0, y: 0 })]);

    expect(page.length).toBe(3 * 3 * CHANNELS);
    expect(at(page, 3, 2, 2)).toEqual(RED);
    expect(at(page, 3, 2, 0)).toEqual(RED);
  });
});
