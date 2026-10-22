import { describe, expect, it } from "vitest";
import {
  cutSpan,
  fitsTexture,
  gridSpan,
  linearBounds,
  onGrid,
  paddingOnGrid,
  textureBytes
} from "../../kept/geometry";

// ---------------------------------------------------------------------------
// The picture grid (spec 23 P2): every texture works on the pixel grid Pixi's
// live filter pass uses, so a picture equals the live frame at rest. Pure
// numbers, literal cases.
// ---------------------------------------------------------------------------

describe("the picture grid", () => {
  it("a picture keeps the canvas phase of its content", () => {
    // tx = 100.3 at r = rs = 2: the picture starts on texel 200, the content lands 0.3 px into it.
    const { first, texels } = gridSpan(100.3, 164.3, 2);
    const X0 = first / 2;

    expect(X0).toBe(100);
    expect(100.3 - X0).toBeCloseTo(0.3, 10);
    expect(texels).toBe(129);
  });

  it("a blur at half resolution puts the picture on the half-resolution grid", () => {
    // rs = 0.5, tx = 101: texel 50 starts at canvas 100.
    expect(gridSpan(101, 141, 0.5).first / 0.5).toBe(100);
    expect(gridSpan(101, 141, 0.5).texels).toBe(21);
  });

  it("the output of the stack lands where Pixi draws it live", () => {
    // P = 10 at rs = 2: Ps = 10, and the canvas origin O + Ps − P of the output is X0 − P.
    const X0 = 100;
    const Ps = paddingOnGrid(10, 2);
    const O = X0 - Ps;

    expect(Ps).toBe(10);
    expect(O + Ps - 10).toBe(X0 - 10);
    // A padding off the grid of a half-resolution blur grows to the next texel.
    expect(paddingOnGrid(3, 0.5)).toBe(4);
  });

  it("a rotated view takes the box of its rotated corners", () => {
    // 90°: (a, b, c, d) = (0, 1, -1, 0); a 64 x 32 box from the origin turns into x −32..0, y 0..64.
    const box = linearBounds(0, 1, -1, 0, { minX: 0, minY: 0, maxX: 64, maxY: 32 });

    expect(box).toEqual({ x0: -32, y0: 0, x1: 0, y1: 64 });
    expect(linearBounds(2, 0, 0, 2, { minX: -32, minY: -32, maxX: 32, maxY: 32 })).toEqual({
      x0: -64,
      y0: -64,
      x1: 64,
      y1: 64
    });
  });

  it("a whole-texel move needs no settle; a fractional one does at rest", () => {
    expect(onGrid(1, 2, 2)).toBe(true);
    expect(onGrid(0.25, 2, 2)).toBe(false);
    // Half a CSS px is a whole texel at resolution 2 on both grids.
    expect(onGrid(0.5, 2, 2)).toBe(true);
    // A whole texel of the stack's half-resolution grid is two canvas texels at r = 1: still on both.
    expect(onGrid(2, 0.5, 1)).toBe(true);
    expect(onGrid(1, 0.5, 1)).toBe(false);
  });

  // Bug F53: the cut must keep what lies within the padding off the canvas, as the live pass pads after its cut; a
  // cut at the canvas edge drops a glow just off the screen, a cut wider than the padding keeps texels for nothing.
  it("cuts a span to the canvas and the padding around it, exactly", () => {
    expect(cutSpan(-40, 120, 100, 10)).toEqual({ start: -10, end: 110 });
    expect(cutSpan(-10, 110, 100, 10)).toEqual({ start: -10, end: 110 });
    // Wholly past the padding: empty.
    const off = cutSpan(-50, -11, 100, 10);

    expect(off.end > off.start).toBe(false);
  });

  it("a picture above 4096 device pixels is not taken, nor an empty one", () => {
    expect(fitsTexture(2048, 300, 2)).toBe(true);
    expect(fitsTexture(2048.5, 300, 2)).toBe(false);
    expect(fitsTexture(0, 300, 2)).toBe(false);
    expect(textureBytes(384, 832, 2)).toBe(768 * 1664 * 4);
  });
});
