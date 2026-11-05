import { describe, expect, it } from "vitest";
import { AURA_GLSL, AURA_WGSL, Aura } from "../../../set/aura";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Aura` member of the set. Bun has no GPU: the pixels are the
// visual leg's (`tests/visual/effects-set.visual.ts`); here its definition and
// the text of its bodies. Its 13 samples are the budget test's.
// ---------------------------------------------------------------------------

/**
 * The number of the `AURA_TAU` constant of a body, WGSL or GLSL.
 *
 * @param body - The body.
 * @returns The number, or `undefined` when the constant is missing.
 */
function tauOf(body: string): number | undefined {
  const match = /AURA_TAU(?:: f32)? = ([\d.]+);/.exec(body);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

describe("Aura", () => {
  memberCases({ member: Aura, wgsl: AURA_WGSL, glsl: AURA_GLSL, padding: "spread" });

  // Bug: the table's defaults are lost, or the export's example lies.
  it("takes the fields of its example", () => {
    expect(Aura({ color: 0xff_d7_00, spread: 12 }).value).toEqual({
      color: 0xff_d7_00,
      strength: 1,
      spread: 12,
      enabled: true,
      order: 0
    });
  });

  // Bug: the ring is wider than the padding (the halo is cut at the frame's edge) or narrower (it never reaches it),
  // or it is measured on the pooled texture's size instead of the frame's: a halo of another width live and on the quad.
  it("probes on a ring as wide as its padding, in CSS px of the input frame", () => {
    expect(AURA_WGSL).toContain("let reach = fu.spread / inputFrame();");
    expect(AURA_WGSL).toContain("sampleInput(n + vec2<f32>(cos(turn), sin(turn)) * reach)");
  });

  // Bug: the GLSL spokes turn another way than the WGSL ones: WebGL phones draw a lopsided halo.
  it("turns its spokes by the same full turn in both languages", () => {
    expect(tauOf(AURA_WGSL)).toBeCloseTo(2 * Math.PI, 12);
    expect(tauOf(AURA_GLSL)).toBe(tauOf(AURA_WGSL));
  });

  // Bug: the halo is drawn over the source (a coloured view) or burns past an alpha of 1 at strength 2.
  it("draws the halo under the source, clamped to 1", () => {
    expect(AURA_WGSL).toContain(
      "let halo = min(smoothstep(0.0, 0.5, ring / 12.0) * max(fu.strength, 0.0), 1.0);"
    );
    expect(AURA_WGSL).toContain("return c + vec4<f32>(fu.color * halo, halo) * (1.0 - c.a);");
  });
});
