import { describe, expect, it } from "vitest";
import { FOLD_GLSL, FOLD_WGSL, Fold } from "../../../set/fold";
import { evaluate } from "./body-eval";
import { memberCases } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the `Fold` member of the set. Bun has no GPU: the pixels are the
// visual leg's (`tests/visual/effects-set.visual.ts`, a half turn at the centre
// of a card is its colour in shade); here its definition and the text of its
// bodies, and its lean evaluated over a turn.
// ---------------------------------------------------------------------------

/**
 * The number of the `FOLD_PADDING` constant of a body, WGSL or GLSL.
 *
 * @param body - The body.
 * @returns The number, or `undefined` when the constant is missing.
 */
function paddingOf(body: string): number | undefined {
  const match = /FOLD_PADDING(?:: f32)? = ([\d.]+);/.exec(body);

  return match?.[1] === undefined ? undefined : Number(match[1]);
}

describe("Fold", () => {
  memberCases({ member: Fold, wgsl: FOLD_WGSL, glsl: FOLD_GLSL, padding: 8 });

  // Bug: the table's defaults are lost (a Fold at rest turned or leaning), or the example's axis is not a number.
  it("is flat at its defaults and takes its axis as a number", () => {
    expect(Fold({ axis: 1 }).value).toEqual({
      angle: 0,
      axis: 1,
      perspective: 0.5,
      shade: 0.4,
      enabled: true,
      order: 0
    });
  });

  // Bug: the content box is mapped with another padding than the frame has: the turned view is off its centre and cut
  // at one side, live and on the quad alike.
  it("maps its content box with the padding of its definition, in both languages and both ways", () => {
    expect(paddingOf(FOLD_WGSL)).toBe(Fold.filter.padding);
    expect(paddingOf(FOLD_GLSL)).toBe(Fold.filter.padding);
    expect(FOLD_WGSL).toContain("let q = (n * s - FOLD_PADDING) / (s - 2.0 * FOLD_PADDING);");
    expect(FOLD_WGSL).toContain(
      "let c = sampleInput((place * (s - 2.0 * FOLD_PADDING) + FOLD_PADDING) / s);"
    );
  });

  // Bug: the near edge grows past the 8 px padding at a quarter turn: a tall card is cut flat at its top and bottom.
  it("never draws the turned view taller than its content box, and keeps the near edge whole", () => {
    for (let step = 0; step <= 64; step += 1) {
      const angle = (step / 64) * 2 * Math.PI;

      for (const perspective of [0, 0.5, 1]) {
        // The lean of a place of the content along the turned axis, 0..1: places outside it are not drawn.
        const leanAt = (su: number): number =>
          evaluate(FOLD_WGSL, { from: "lean", to: "lean" }, { su, angle, perspective });
        const leans = [0, 0.25, 0.5, 0.75, 1].map(su => leanAt(su));

        expect(Math.max(...leans)).toBeLessThanOrEqual(1 + 1e-12);
        expect(Math.max(leanAt(0), leanAt(1))).toBeCloseTo(1, 12);
      }
    }
  });
});
