import { describe, expect, it } from "vitest";
import { REVEAL_LINE_GLSL, REVEAL_LINE_WGSL, RevealLine } from "../../../set/reveal-line";
import { evaluate } from "./body-eval";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `RevealLine` member of the set. Bun has no GPU: the pixels are
// the visual leg's (`tests/visual/effects-set.visual.ts`); here its definition,
// the text of its bodies, and its formula evaluated at the corners of the view.
// ---------------------------------------------------------------------------

/** The four corners of the view, in 0..1 of the input frame. */
const CORNERS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 }
] as const;

/** The angles the spec names: along an axis, the diagonal, the other axis, and one past it. */
const ANGLES = [0, Math.PI / 4, Math.PI / 2, 2] as const;

describe("RevealLine", () => {
  memberCases({ member: RevealLine, wgsl: REVEAL_LINE_WGSL, glsl: REVEAL_LINE_GLSL, padding: 0 });

  // Bug: a RevealLine spawned at its defaults shows the view, or the export's example lies.
  it("hides the view at its defaults and takes the fields of its example", () => {
    expect(RevealLine({ angle: Math.PI / 2 }).value).toEqual({
      progress: 0,
      angle: Math.PI / 2,
      soft: 0.05,
      enabled: true,
      order: 0
    });
  });

  // Bug: a corner that never shows: without `reach`, the place along the diagonal runs past 0..1 at 45°.
  it.each(ANGLES)("places the four corners in 0..1, with a 0 and a 1, at angle %d", angle => {
    const places = CORNERS.map(uv =>
      evaluate(REVEAL_LINE_WGSL, { from: "n", to: "p" }, { uv, angle })
    );

    for (const place of places) {
      expect(place).toBeGreaterThanOrEqual(-1e-12);
      expect(place).toBeLessThanOrEqual(1 + 1e-12);
    }

    expect(Math.min(...places)).toBeCloseTo(0, 12);
    expect(Math.max(...places)).toBeCloseTo(1, 12);
  });

  // Bug: progress 1 leaves a corner hidden, or progress 0 leaves a sliver of the view.
  it.each(ANGLES)("shows every corner at progress 1 and none at 0, at angle %d", angle => {
    for (const soft of [0, 0.05, 0.1]) {
      for (const uv of CORNERS) {
        const at = (progress: number): number =>
          evaluate(REVEAL_LINE_WGSL, { from: "n", to: "return" }, { uv, angle, soft, progress });

        expect(at(1)).toBe(1);
        expect(at(0)).toBe(0);
      }
    }
  });
});
