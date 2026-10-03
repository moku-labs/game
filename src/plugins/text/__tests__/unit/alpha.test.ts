import { describe, expect, it } from "vitest";
import { msdfAlpha, msdfOpacity } from "../../alpha";

// ---------------------------------------------------------------------------
// Pixi 8.21 draws a distance-field font with `localUniformMSDFBit` and
// `mSDFBit`. The oracle below is that shader, step by step, for a texel deep
// inside a glyph (coverage 1): the group alpha `g` premultiplies the colour,
// `calculateMSDFAlpha` raises `vColor.a × coverage` to a gamma leaning on the
// luma of `vColor.rgb`, and the template multiplies the result by `vColor`.
// ---------------------------------------------------------------------------

/** The opacity Pixi's MSDF shader draws a glyph's inside at, for a group alpha and a colour. */
function shaderOpacity(groupAlpha: number, color: number): number {
  const rgb = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff].map(
    channel => (channel / 255) * groupAlpha
  );
  const luma = 0.299 * (rgb[0] ?? 0) + 0.587 * (rgb[1] ?? 0) + 0.114 * (rgb[2] ?? 0);
  const gamma = 1 + (1 / 2.2 - 1) * luma;
  const coverage = (groupAlpha * 1) ** gamma;

  return coverage * groupAlpha;
}

/** Deep ink, the fill of the fixture's `ui.field` style its placeholder is drawn with. */
const deepInk = 0x24_12_0a;

describe("msdfOpacity", () => {
  it("is the shader's own opacity: alpha 0.5 draws at about 0.25", () => {
    expect(msdfOpacity(0.5, deepInk)).toBeCloseTo(shaderOpacity(0.5, deepInk), 10);
    expect(msdfOpacity(0.5, deepInk)).toBeCloseTo(0.2542, 4);
    expect(msdfOpacity(0.5, 0x00_00_00)).toBe(0.25);
  });

  it("leaves an opaque glyph opaque and an invisible one invisible", () => {
    expect(msdfOpacity(1, 0xff_ff_ff)).toBe(1);
    expect(msdfOpacity(0, 0xff_ff_ff)).toBe(0);
  });
});

describe("msdfAlpha", () => {
  it("answers the group alpha the shader draws at the asked opacity", () => {
    for (const color of [deepInk, 0x00_00_00, 0xff_ff_ff, 0xff_f3_d6, 0xff_00_00]) {
      for (const opacity of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        expect(shaderOpacity(msdfAlpha(opacity, color), color)).toBeCloseTo(opacity, 6);
      }
    }
  });

  it("is the square root for black, which the gamma leaves alone", () => {
    expect(msdfAlpha(0.25, 0x00_00_00)).toBe(0.5);
  });

  it("draws the fixture's placeholder at half alpha: 0.7029 for deep ink", () => {
    expect(msdfAlpha(0.5, deepInk)).toBeCloseTo(0.7029, 4);
  });

  it("keeps 0 and 1, and clamps what lies outside them", () => {
    expect(msdfAlpha(0, deepInk)).toBe(0);
    expect(msdfAlpha(1, deepInk)).toBe(1);
    expect(msdfAlpha(-0.2, deepInk)).toBe(0);
    expect(msdfAlpha(1.3, deepInk)).toBe(1);
  });
});
