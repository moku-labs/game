import { describe, expect, it } from "vitest";
import { GRADIENT_MAP_GLSL, GRADIENT_MAP_WGSL, GradientMap } from "../../../set/gradient-map";
import { evaluate } from "./body-eval";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `GradientMap` member of the set. Bun has no GPU: the pixels
// are the visual leg's (`tests/visual/effects-set.visual.ts`, black maps to
// `dark`); here its definition, the text of its bodies, and its lines evaluated
// on the CPU for grey colours (a colour of three equal channels is one number).
// ---------------------------------------------------------------------------

/**
 * The mapped colour of a luma, for grey stops.
 *
 * @param l - The luma.
 * @param stops - The greys of `dark`, `middle` and `light`.
 * @param stops.dark - The colour of black.
 * @param stops.middle - The colour of a half.
 * @param stops.light - The colour of white.
 * @returns The mapped grey.
 */
function mapped(l: number, stops: { dark: number; middle: number; light: number }): number {
  return evaluate(GRADIENT_MAP_WGSL, { from: "m", to: "m" }, { l, ...stops });
}

describe("GradientMap", () => {
  memberCases({
    member: GradientMap,
    wgsl: GRADIENT_MAP_WGSL,
    glsl: GRADIENT_MAP_GLSL,
    padding: 0
  });

  // Bug: the table's defaults are lost (a map that draws nothing until its amount is set), or the example lies.
  it("maps fully by default and takes the colours of its example", () => {
    expect(GradientMap({ dark: 0x2b_1a_0e, middle: 0x9c_6b_3c, light: 0xf5_e6_c8 }).value).toEqual({
      dark: 0x2b_1a_0e,
      middle: 0x9c_6b_3c,
      light: 0xf5_e6_c8,
      amount: 1,
      enabled: true,
      order: 0
    });
  });

  // Bug: the luma read from the premultiplied colour (a half-transparent edge maps darker than its middle), or a
  // transparent pixel divides by 0 and draws NaN.
  it("reads the straight colour of the premultiplied input, and black where it is transparent", () => {
    expect(evaluate(GRADIENT_MAP_WGSL, { from: "s", to: "s" }, { c: { rgb: 0.25, a: 0.5 } })).toBe(
      0.5
    );
    expect(evaluate(GRADIENT_MAP_WGSL, { from: "s", to: "s" }, { c: { rgb: 0, a: 0 } })).toBe(0);
  });

  // Bug: Rec. 601 weights, or the channels' weights swapped: a red maps as light as a green.
  it("weighs the channels by the Rec. 709 luma", () => {
    expect(GRADIENT_MAP_WGSL).toContain("dot(s, vec3<f32>(0.2126, 0.7152, 0.0722))");
  });

  // Bug: the halves swapped, or each spans the whole range: a mid grey is not `middle`, white is not `light`.
  it("mixes dark to middle under a half and middle to light above it", () => {
    const stops = { dark: 0.1, middle: 0.6, light: 0.9 };

    expect(mapped(0, stops)).toBeCloseTo(0.1, 12);
    expect(mapped(0.25, stops)).toBeCloseTo(0.35, 12);
    expect(mapped(0.5, stops)).toBeCloseTo(0.6, 12);
    expect(mapped(0.4999, stops)).toBeCloseTo(0.6, 3);
    expect(mapped(0.75, stops)).toBeCloseTo(0.75, 12);
    expect(mapped(1, stops)).toBeCloseTo(0.9, 12);
  });

  // Bug: `amount` mixes the wrong way (0 maps fully), or past 1 it overshoots the map; the alpha is lost.
  it("mixes the straight colour to the map by amount, clamped, and keeps the alpha premultiplied", () => {
    const mixed = (amount: number): number =>
      evaluate(GRADIENT_MAP_WGSL, { from: "o", to: "o" }, { s: 0.2, m: 0.8, amount });

    expect(mixed(0)).toBeCloseTo(0.2, 12);
    expect(mixed(0.5)).toBeCloseTo(0.5, 12);
    expect(mixed(1.5)).toBeCloseTo(0.8, 12);
    expect(GRADIENT_MAP_WGSL).toContain("return vec4<f32>(o * c.a, c.a);");
  });
});
