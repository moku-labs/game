import { describe, expect, it } from "vitest";
import { SHINE_GLSL, SHINE_WGSL, Shine } from "../../../set/shine";
import { evaluate, type Vec2 } from "./body-eval";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Shine` member of the set. Bun has no GPU: the pixels are the
// visual leg's (`tests/visual/effects-set.visual.ts`); here its definition, the
// text of its bodies, and its band evaluated over the view.
// ---------------------------------------------------------------------------

/** Places over the whole view, 11 × 11. */
const PLACES = Array.from({ length: 11 * 11 }, (_, index) => ({
  x: (index % 11) / 10,
  y: Math.floor(index / 11) / 10
}));

/**
 * The band's light at a place, before the strength.
 *
 * @param uv - The place.
 * @param value - The member's fields over its defaults.
 * @returns 0 dark, 1 the band's line.
 */
function band(uv: Vec2, value: Record<string, number> = {}): number {
  return evaluate(SHINE_WGSL, { from: "n", to: "band" }, { ...Shine().value, ...value, uv });
}

describe("Shine", () => {
  memberCases({ member: Shine, wgsl: SHINE_WGSL, glsl: SHINE_GLSL, padding: 0 });

  // Bug: the table's defaults are lost, so the example's sweep starts somewhere on the view.
  it("starts before the view", () => {
    expect(Shine().value).toEqual({
      position: -0.5,
      width: 0.2,
      angle: 0.6,
      strength: 0.6,
      enabled: true,
      order: 0
    });
  });

  // Bug: a resting Shine draws a stripe across a corner: the band placed on the bare dot product reaches into the view.
  it("lights no place of the view at -0.5 and at 1.5, at any angle", () => {
    for (const angle of [0, 0.6, Math.PI / 4, 2]) {
      for (const position of [-0.5, 1.5]) {
        expect(PLACES.map(uv => band(uv, { angle, position })).filter(value => value > 0)).toEqual(
          []
        );
      }
    }
  });

  // Bug: the sweep misses the middle of the view, or lights it at another place than `position`.
  it("is full on its line: the centre at position 0.5", () => {
    expect(band({ x: 0.5, y: 0.5 }, { position: 0.5 })).toBe(1);
    expect(band({ x: 0.5, y: 0.5 }, { position: 0.5 + 0.2 })).toBe(0);
  });

  // Bug: light added to the alpha: the transparent pixels around the shape glow, a lit rectangle.
  it("adds light to the colour at the input's alpha and keeps the alpha", () => {
    expect(SHINE_WGSL).toContain("let light = max(fu.strength, 0.0) * band * c.a;");
    expect(SHINE_WGSL).toContain(
      "return vec4<f32>(min(c.rgb + vec3<f32>(light), vec3<f32>(c.a)), c.a);"
    );
  });
});
