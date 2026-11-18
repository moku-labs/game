import { describe, expect, it } from "vitest";
import { MIRROR_GLSL, MIRROR_WGSL, Mirror } from "../../../set/mirror";
import { evaluate, type Vec2 } from "./body-eval";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Mirror` member of the set. Bun has no GPU: the pixels are the
// visual leg's (`tests/visual/effects-set.visual.ts`, the square flipped); here
// its definition, the text of its bodies, and its place and fade evaluated on
// the CPU.
// ---------------------------------------------------------------------------

/**
 * The place a pixel reads.
 *
 * @param n - The pixel's place, 0..1 of the view.
 * @param axis - The member's `axis`.
 * @returns The place.
 */
function readAt(n: Vec2, axis: number): Vec2 {
  return evaluate(MIRROR_WGSL, { from: "a", to: "q" }, { n, axis }) as unknown as Vec2;
}

/**
 * What a pixel keeps of its fade.
 *
 * @param n - The pixel's place, 0..1 of the view.
 * @param axis - The member's `axis`.
 * @param fade - The member's `fade`.
 * @returns 1 whole, 0 gone.
 */
function keptAt(n: Vec2, axis: number, fade: number): number {
  return evaluate(MIRROR_WGSL, { from: "a", to: "keep" }, { n, axis, fade });
}

describe("Mirror", () => {
  memberCases({ member: Mirror, wgsl: MIRROR_WGSL, glsl: MIRROR_GLSL, padding: 0 });

  // Bug: the table's defaults are lost (a Mirror at rest flips left to right), or the example lies.
  it("flips top to bottom by default and takes the fields of its example", () => {
    expect(Mirror({ alpha: 0.4, fade: 0.5 }).value).toEqual({
      axis: 1,
      alpha: 0.4,
      fade: 0.5,
      enabled: true,
      order: 0
    });
  });

  // Bug: the axes swapped, or both flipped: a reflection on the floor stands on its head and back to front.
  it("flips top to bottom on axis 1 and left to right on axis 0", () => {
    const flipped = readAt({ x: 0.2, y: 0.3 }, 1);
    const turned = readAt({ x: 0.2, y: 0.3 }, 0);

    expect([flipped.x, flipped.y]).toEqual([expect.closeTo(0.2, 12), expect.closeTo(0.7, 12)]);
    expect([turned.x, turned.y]).toEqual([expect.closeTo(0.8, 12), expect.closeTo(0.3, 12)]);
  });

  // Bug: the fade measured from the far edge (the reflection fades next to the object), never gone at `fade`, or a
  // fade of 0 hands smoothstep two equal edges and hides the whole view.
  it("fades from its mirror line to gone at fade, and keeps the view whole at fade 0", () => {
    expect(keptAt({ x: 0.9, y: 0 }, 1, 0.5)).toBe(1);
    expect(keptAt({ x: 0.9, y: 0.25 }, 1, 0.5)).toBeCloseTo(0.5, 12);
    expect(keptAt({ x: 0.1, y: 0.5 }, 1, 0.5)).toBe(0);
    expect(keptAt({ x: 0.1, y: 0.9 }, 1, 0.5)).toBe(0);
    expect(keptAt({ x: 0.5, y: 0.1 }, 0, 0.5)).toBe(0);
    expect(keptAt({ x: 0.1, y: 0.5 }, 0, 0.5)).toBeGreaterThan(0.5);

    for (const fade of [0, -1]) {
      for (const t of [0, 0.5, 1]) expect(keptAt({ x: t, y: t }, 1, fade)).toBe(1);
    }
  });

  // Bug: alpha past 1 burns the premultiplied colour, or the fade is not applied to the pixel.
  it("multiplies the pixel by its alpha, clamped, and its fade", () => {
    expect(MIRROR_WGSL).toContain("return sampleInput(q) * (clamp(fu.alpha, 0.0, 1.0) * keep);");
  });
});
