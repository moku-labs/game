import { describe, expect, it } from "vitest";
import { REVEAL_ROUND_GLSL, REVEAL_ROUND_WGSL, RevealRound } from "../../../set/reveal-round";
import { evaluate, type Vec2 } from "./body-eval";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `RevealRound` member of the set. Bun has no GPU: the pixels
// are the visual leg's (`tests/visual/effects-set.visual.ts`); here its
// definition, the text of its bodies, and its formula evaluated over the view.
// ---------------------------------------------------------------------------

/** Places over the whole view, 21 × 21. */
const PLACES = Array.from({ length: 21 * 21 }, (_, index) => ({
  x: (index % 21) / 20,
  y: Math.floor(index / 21) / 20
}));

/**
 * How much of the input a place shows.
 *
 * @param uv - The place.
 * @param value - The member's fields.
 * @returns 0 hidden, 1 shown.
 */
function shown(uv: Vec2, value: Record<string, number>): number {
  return evaluate(
    REVEAL_ROUND_WGSL,
    { from: "n", to: "return" },
    { ...RevealRound().value, ...value, uv }
  );
}

describe("RevealRound", () => {
  memberCases({
    member: RevealRound,
    wgsl: REVEAL_ROUND_WGSL,
    glsl: REVEAL_ROUND_GLSL,
    padding: 0
  });

  // Bug: a RevealRound spawned at its defaults shows the view, or its fields are not the table's.
  it("is closed at its defaults", () => {
    expect(RevealRound({ wobble: 0.04 }).value).toEqual({
      x: 0.5,
      y: 0.5,
      radius: 0,
      soft: 0.05,
      wobble: 0.04,
      enabled: true,
      order: 0
    });
  });

  // Bug: a closed window shows a dot at its centre, or wherever the wobble pulls the distance under 0.
  it("hides every place at radius 0, also with the widest wobble", () => {
    for (const wobble of [0, 0.2]) {
      expect(PLACES.map(uv => shown(uv, { radius: 0, wobble })).filter(value => value > 0)).toEqual(
        []
      );
    }
  });

  // Bug: the example's window stops short of a corner: the view never shows whole at the end of the tween.
  it("shows every place at the example's radius 1.2 from the centre, also with the widest wobble", () => {
    for (const wobble of [0, 0.2]) {
      expect(
        PLACES.map(uv => shown(uv, { radius: 1.2, wobble })).filter(value => value < 1)
      ).toEqual([]);
    }
  });
});
