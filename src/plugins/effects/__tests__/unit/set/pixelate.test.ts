import { describe, expect, it } from "vitest";
import { PIXELATE_GLSL, PIXELATE_WGSL, Pixelate } from "../../../set/pixelate";
import { evaluate } from "./body-eval";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Pixelate` member of the set. Bun has no GPU: the pixels are
// the visual leg's (`tests/visual/effects-set.visual.ts`, a pixel of a block
// reads its centre); here its definition, the text of its bodies, and the place
// it reads evaluated on the CPU, one axis at a time (the axes do not mix).
// ---------------------------------------------------------------------------

/** The frame's width in CSS px the places are counted in. */
const FRAME = 240;

/**
 * The place a pixel reads, on one axis, from its place held inside the frame.
 *
 * @param px - The pixel's place in CSS px of the frame, as the body holds it.
 * @param size - The member's `size`.
 * @returns The place it reads, in CSS px of the frame.
 */
function readAt(px: number, size: number): number {
  return (
    evaluate(PIXELATE_WGSL, { from: "side", to: "q" }, { n: px / FRAME, px, s: FRAME, size }) *
    FRAME
  );
}

describe("Pixelate", () => {
  memberCases({ member: Pixelate, wgsl: PIXELATE_WGSL, glsl: PIXELATE_GLSL, padding: 0 });

  // Bug: the table's default is lost (a Pixelate at rest draws no blocks), or the example lies.
  it("takes the fields of its example", () => {
    expect(Pixelate().value).toEqual({ size: 8, enabled: true, order: 0 });
  });

  // Bug: blocks counted from the frame's centre, or a pixel reads its block's corner: the picture shifts by half a
  // block as it pixelates, and a tween of size swims.
  it("reads the centre of its block, counted from the frame's top-left", () => {
    expect(readAt(13, 8)).toBeCloseTo(12, 9);
    expect(readAt(0, 8)).toBeCloseTo(4, 9);
    expect(readAt(18, 16)).toBeCloseTo(24, 9);
    expect(readAt(31.9, 16)).toBeCloseTo(24, 9);
  });

  // Bug: the last texel, at n 1 and so exactly on a block's edge when size divides the frame, reads a block past the
  // frame on one backend and the last block on the other: the quad and the live pass draw another last column.
  it("holds its place inside the frame, half a CSS px in from its far edge", () => {
    expect(PIXELATE_WGSL).toContain("let px = clamp(n * s, vec2<f32>(0.0), s - 0.5);");
    expect(readAt(FRAME - 0.5, 12)).toBeCloseTo(234, 9);
  });

  // Bug: a size of 1 still snaps to CSS px (blocks of 2 × 2 texels at resolution 2), or a size of 0 divides by 0 and
  // the NaN survives the mix that should drop it: a tween down to 1 never ends on the view as it is.
  it("draws the view as it is at a size of 1 or less", () => {
    for (const size of [1, 0.5, 0, -3]) {
      expect(readAt(13.3, size)).toBeCloseTo(13.3, 9);
    }

    expect(readAt(13.3, 1.5)).toBeCloseTo(12.75, 9);
  });
});
