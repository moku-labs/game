import { describe, expect, it } from "vitest";
import type { TransformValue } from "../../../renderer/components";
import { restTransform } from "../../layout/motion";
import { drawnRect, samePose } from "../../visual";

// ---------------------------------------------------------------------------
// Unit: the per-axis scale of the transform style (F179). `scaleX` / `scaleY` reach the rest `Transform` as written,
// never folded with `fit`; a style without them writes no key; a missing factor equals 1 in every comparison and rect.
// ---------------------------------------------------------------------------

/** A 200 x 40 box at the origin of a root element. */
const RECT = { x: 0, y: 0, w: 200, h: 40 };

/**
 * A pose at the origin with the given fields.
 *
 * @param patch - What differs from the identity.
 * @returns The pose.
 */
function pose(patch: Partial<TransformValue>): TransformValue {
  return { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 }, ...patch };
}

describe("restTransform, per axis", () => {
  // Bug: every element gains `scaleX: 1`, and every describe.json and snapshot changes.
  it("writes no scaleX or scaleY key for a style without them", () => {
    const rest = restTransform(RECT, undefined, { scale: 1.2, origin: "center" });

    expect(Object.keys(rest)).not.toContain("scaleX");
    expect(Object.keys(rest)).not.toContain("scaleY");
  });

  // Bug: the style's factor is dropped, or `fit` is folded into it as well as into `scale`.
  it("copies scaleX as written and folds fit into scale alone", () => {
    const rest = restTransform(RECT, undefined, { scaleX: 2, origin: "center" }, 0.5);

    expect(rest.scale).toBe(0.5);
    expect(rest.scaleX).toBe(2);
    expect(Object.keys(rest)).not.toContain("scaleY");
  });
});

describe("samePose, per axis", () => {
  // Bug: a missing factor differs from 1, so a rest pose is written again in every frame.
  it("counts a missing factor as 1", () => {
    expect(samePose(pose({}), pose({ scaleX: 1 }))).toBe(true);
    expect(samePose(pose({ scaleY: 1 }), pose({}))).toBe(true);
  });

  // Bug: the factors are not compared, so a new style of scaleX 0.5 never reaches the Transform.
  it("tells a stretched pose from a plain one", () => {
    expect(samePose(pose({}), pose({ scaleX: 0.5 }))).toBe(false);
    expect(samePose(pose({ scaleY: 2 }), pose({ scaleY: 3 }))).toBe(false);
  });
});

describe("drawnRect, per axis", () => {
  // Bug: the rect of a stretched text is its full width.
  it("halves the width of a box of scaleX 0.5 and keeps its height", () => {
    expect(drawnRect(pose({ scaleX: 0.5 }), RECT)).toEqual({ x: 0, y: 0, w: 100, h: 40 });
  });

  // Bug: the factor is applied to the size but not to the place about the pivot.
  it("stretches about the pivot on each axis", () => {
    expect(
      drawnRect(pose({ x: 100, y: 20, scale: 2, scaleY: 0.5, pivot: { x: 100, y: 20 } }), RECT)
    ).toEqual({ x: -100, y: 0, w: 400, h: 40 });
  });
});

describe("drawnRect, flipped", () => {
  // Bug: a mirrored view gets a negative width, so a guide hole or a locate rect is turned inside out.
  it("keeps the size positive and starts at the left edge of a view mirrored on X", () => {
    expect(drawnRect(pose({ x: 200, scaleX: -0.5 }), RECT)).toEqual({
      x: 100,
      y: 0,
      w: 100,
      h: 40
    });
  });
});
