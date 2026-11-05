import { describe, expect, it } from "vitest";
import { DISSOLVE_GLSL, DISSOLVE_WGSL, Dissolve } from "../../../set/dissolve";
import { evaluate } from "./body-eval";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Dissolve` member of the set. Bun has no GPU: the pixels are
// the visual leg's (`tests/visual/effects-set.visual.ts`); here its definition,
// the text of its bodies, and its edge evaluated over the grain's whole range.
// The hash itself is the head's (`set-head.test.ts`).
// ---------------------------------------------------------------------------

/** Grains from the lowest the hash gives to the highest: 0 and (2^24 − 1) / 2^24. */
const GRAINS = [0, 1 / 16_777_216, 0.25, 0.5, 0.75, (16_777_216 - 1) / 16_777_216] as const;

/**
 * What the edge does to a grain.
 *
 * @param grain - The noise at the pixel.
 * @param value - The member's fields over its defaults.
 * @returns How much of the pixel is kept, and how much of it is tinted.
 */
function edgeOf(grain: number, value: Record<string, number>): { keep: number; glow: number } {
  const scope = { ...Dissolve().value, ...value, grain };

  return {
    keep: evaluate(DISSOLVE_WGSL, { from: "rim", to: "keep" }, scope),
    glow: evaluate(DISSOLVE_WGSL, { from: "rim", to: "glow" }, scope)
  };
}

describe("Dissolve", () => {
  memberCases({ member: Dissolve, wgsl: DISSOLVE_WGSL, glsl: DISSOLVE_GLSL, padding: 0 });

  // Bug: the table's defaults are lost, or the export's example lies.
  it("takes the fields of its example", () => {
    expect(Dissolve({ progress: 0.5 }).value).toEqual({
      progress: 0.5,
      scale: 8,
      edge: 0.08,
      edgeColor: 0xff_ff_ff,
      enabled: true,
      order: 0
    });
  });

  // Bug: a dissolve at rest already eats or tints a few pixels, or one at its end leaves a few: the edge sits on the
  // bare progress, and the grain reaches 0 and nearly 1.
  it("keeps every grain untinted at progress 0 and none at 1, at any edge", () => {
    for (const edge of [0, 0.08, 0.3]) {
      for (const grain of GRAINS) {
        expect(edgeOf(grain, { progress: 0, edge })).toEqual({ keep: 1, glow: 0 });
        expect(edgeOf(grain, { progress: 1, edge }).keep).toBe(0);
      }
    }
  });

  // Bug: the rim is drawn on the eaten side, or not at all: the edge of what is left never glows.
  it("tints the grain just above the edge and keeps it", () => {
    const { keep, glow } = edgeOf(0.5, { progress: 0.56 / 1.16 });

    expect(keep).toBe(1);
    expect(glow).toBeGreaterThan(0.5);
  });
});
