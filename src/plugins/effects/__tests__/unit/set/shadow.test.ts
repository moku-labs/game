import { describe, expect, it } from "vitest";
import { SHADOW_GLSL, SHADOW_WGSL, Shadow } from "../../../set/shadow";
import { evaluate, type Vec2 } from "./body-eval";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Shadow` member of the set. Bun has no GPU: the pixels are the
// visual leg's (`tests/visual/effects-set.visual.ts`, under an opaque card
// the shadow is its colour at its alpha); here its definition, the text of its
// bodies, and its reach evaluated on the CPU. Its samples are the budget test's.
// ---------------------------------------------------------------------------

/**
 * The number of a constant of a body, WGSL or GLSL.
 *
 * @param body - The body.
 * @param name - The constant.
 * @returns The number, or `undefined` when the constant is missing.
 */
function constantOf(body: string, name: string): number | undefined {
  const match = new RegExp(String.raw`${name}(?:: f32)? = ([\d.]+);`).exec(body);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** The scope of the body's reach. */
const REACH = { SHADOW_REACH: constantOf(SHADOW_WGSL, "SHADOW_REACH") ?? Number.NaN };

describe("Shadow", () => {
  memberCases({ member: Shadow, wgsl: SHADOW_WGSL, glsl: SHADOW_GLSL, padding: 16 });

  // Bug: the table's defaults are lost (a Shadow at rest drawn nowhere), or the example lies.
  it("drops 4 px down by default and takes the fields of its example", () => {
    expect(Shadow().value).toEqual({
      x: 0,
      y: 4,
      soft: 4,
      color: 0,
      alpha: 0.5,
      enabled: true,
      order: 0
    });
  });

  // Bug: the reach of the body is another number than the padding: the shadow is cut flat at the frame's edge.
  it("reaches as far as its padding, in both languages", () => {
    expect(constantOf(SHADOW_WGSL, "SHADOW_REACH")).toBe(Shadow.filter.padding);
    expect(constantOf(SHADOW_GLSL, "SHADOW_REACH")).toBe(Shadow.filter.padding);
  });

  // Bug: an offset or a softness past the padding: the shadow is cut at the edge of the padded frame; or the clamp
  // moves an offset that had room.
  it("clamps its offset and softness so |x| + soft and |y| + soft stay within 16", () => {
    for (const soft of [-4, 0, 4, 10, 16, 40]) {
      for (const offset of [-40, -12, -3, 0, 5, 12, 40]) {
        const radius = evaluate(SHADOW_WGSL, { from: "radius", to: "radius" }, { ...REACH, soft });
        const off = evaluate(
          SHADOW_WGSL,
          { from: "radius", to: "off" },
          { ...REACH, soft, x: offset, y: -offset }
        ) as unknown as Vec2;

        expect(radius).toBeGreaterThanOrEqual(0);
        expect(Math.abs(off.x) + radius).toBeLessThanOrEqual(16);
        expect(Math.abs(off.y) + radius).toBeLessThanOrEqual(16);
        if (Math.abs(offset) + radius <= 16) expect(off.x).toBe(offset);
      }
    }
  });

  // Bug: the mean divided by another count than it sums (12 spokes and the centre): a shadow too dark or too light.
  it("averages the centre and a ring of 12, and turns its spokes by the same full turn in both languages", () => {
    const spokes = /for \(var i = 0; i < (\d+); i\+\+\)/.exec(SHADOW_WGSL)?.[1];
    const divisor = /cover \/ ([\d.]+) \*/.exec(SHADOW_WGSL)?.[1];

    expect(Number(spokes)).toBe(12);
    expect(Number(divisor)).toBe(Number(spokes) + 1);
    expect(SHADOW_WGSL).toContain("var cover = sampleInput(base).a;");
    expect(constantOf(SHADOW_WGSL, "SHADOW_TAU")).toBeCloseTo(2 * Math.PI, 12);
    expect(constantOf(SHADOW_GLSL, "SHADOW_TAU")).toBe(constantOf(SHADOW_WGSL, "SHADOW_TAU"));
  });

  // Bug: the shadow drawn over the view (a dark card), or its alpha past 1.
  it("draws the shadow under the source, its alpha clamped to 1", () => {
    expect(SHADOW_WGSL).toContain("let shade = clamp(cover / 13.0 * fu.alpha, 0.0, 1.0);");
    expect(SHADOW_WGSL).toContain("return c + vec4<f32>(fu.color * shade, shade) * (1.0 - c.a);");
  });
});
