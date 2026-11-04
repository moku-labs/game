import { describe, expect, it } from "vitest";
import { GRADE_GLSL, GRADE_WGSL, Grade } from "../../../set/grade";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Grade` member of the set. Bun has no GPU: the pixels are the
// visual leg's (`tests/visual/effects-set.visual.ts`); here its definition and
// the text of its bodies.
// ---------------------------------------------------------------------------

/**
 * The three numbers of the luma constant of a body, WGSL or GLSL.
 *
 * @param body - The body.
 * @returns The weights, or `[]` when the constant is missing.
 */
function lumaOf(body: string): number[] {
  const match = /GRADE_LUMA = vec3(?:<f32>)?\(([\d.]+), ([\d.]+), ([\d.]+)\);/.exec(body);

  return match === null ? [] : match.slice(1).map(Number);
}

describe("Grade", () => {
  memberCases({ member: Grade, wgsl: GRADE_WGSL, glsl: GRADE_GLSL, padding: 0 });

  // Bug: a Grade spawned at its defaults changes the view, or the export's example lies.
  it("is the identity at its defaults and takes the fields of its example", () => {
    expect(Grade().value).toEqual({
      brightness: 1,
      contrast: 1,
      saturation: 1,
      tint: 0xff_ff_ff,
      enabled: true,
      order: 0
    });
    expect(Grade({ saturation: 0 }).value.saturation).toBe(0);
  });

  // Bug: grey is not the Rec. 709 luma, or WebGL greys with other weights than WebGPU.
  it("greys against the Rec. 709 luma in both languages", () => {
    expect(lumaOf(GRADE_WGSL)).toEqual([0.2126, 0.7152, 0.0722]);
    expect(lumaOf(GRADE_GLSL)).toEqual(lumaOf(GRADE_WGSL));
  });

  // Bug: the grade runs on premultiplied colour (a half-transparent edge darkens) or overflows the alpha (a halo).
  it("grades the colour without its alpha, then clamps it before it multiplies the alpha back", () => {
    const lines = GRADE_WGSL.split("\n").map(line => line.trim());
    const clamped = lines.indexOf("rgb = clamp(rgb * fu.tint, vec3<f32>(0.0), vec3<f32>(1.0));");

    expect(lines).toContain("var rgb = c.rgb / max(c.a, 1e-6);");
    expect(clamped).toBeGreaterThan(-1);
    expect(lines.indexOf("return vec4<f32>(rgb * c.a, c.a);")).toBeGreaterThan(clamped);
  });
});
