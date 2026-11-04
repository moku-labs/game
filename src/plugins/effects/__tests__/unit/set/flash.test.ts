import { describe, expect, it } from "vitest";
import { FLASH_GLSL, FLASH_WGSL, Flash } from "../../../set/flash";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Flash` member of the set. Bun has no GPU: the pixels are the
// visual leg's (`tests/visual/effects-set.visual.ts`); here its definition and
// the text of its bodies.
// ---------------------------------------------------------------------------

describe("Flash", () => {
  memberCases({ member: Flash, wgsl: FLASH_WGSL, glsl: FLASH_GLSL, padding: 0 });

  // Bug: a Flash spawned at its defaults washes the view, or the export's example lies.
  it("draws nothing at its defaults and takes the fields of its example", () => {
    expect(Flash().value.amount).toBe(0);
    expect(Flash({ amount: 1, color: 0xff_d7_00 }).value).toEqual({
      amount: 1,
      color: 0xff_d7_00,
      enabled: true,
      order: 0
    });
  });

  // Bug: the colour is not scaled by the input's alpha: the transparent pixels around the shape light up, a rectangle.
  it("mixes towards the colour at the input's own alpha and keeps the alpha", () => {
    expect(FLASH_WGSL).toContain("vec4<f32>(fu.color * c.a, c.a)");
  });

  // Bug: a tween that overshoots 1 (a back easing) burns the colour past `color`.
  it("clamps the amount to 0..1", () => {
    expect(FLASH_WGSL).toContain("clamp(fu.amount, 0.0, 1.0)");
  });
});
