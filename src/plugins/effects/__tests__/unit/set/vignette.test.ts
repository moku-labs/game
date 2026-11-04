import { describe, expect, it } from "vitest";
import { VIGNETTE_GLSL, VIGNETTE_WGSL, Vignette } from "../../../set/vignette";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Vignette` member of the set. Bun has no GPU: the pixels are
// the visual leg's (`tests/visual/effects-set.visual.ts`); here its definition
// and the text of its bodies.
// ---------------------------------------------------------------------------

describe("Vignette", () => {
  memberCases({ member: Vignette, wgsl: VIGNETTE_WGSL, glsl: VIGNETTE_GLSL, padding: 0 });

  // Bug: a Vignette spawned with a radius and a soft edge draws nothing until its amount is set, or the example lies.
  it("draws at full amount by default and takes the fields of its example", () => {
    expect(Vignette({ radius: 0.3, soft: 0.4 }).value).toEqual({
      x: 0.5,
      y: 0.5,
      radius: 0.3,
      soft: 0.4,
      color: 0,
      amount: 1,
      enabled: true,
      order: 0
    });
  });

  // Bug: `soft: 0` hands smoothstep two equal edges, which is undefined: a GPU may draw the disc black or not at all.
  it("keeps the soft edge at least 1e-4 wide", () => {
    expect(VIGNETTE_WGSL).toContain("smoothstep(fu.radius, fu.radius + max(fu.soft, 1e-4), d)");
  });

  // Bug: the vignette eats the alpha, or lights the transparent pixels around the view in its colour.
  it("mixes the colour towards the colour at the input's alpha and keeps the alpha", () => {
    expect(VIGNETTE_WGSL).toContain("return vec4<f32>(mix(c.rgb, fu.color * c.a, v), c.a);");
  });
});
