import { describe, expect, it } from "vitest";
import { type } from "../../../flow/runner/define";
import { Transform } from "../../../renderer/components";
import { defineAnimation, mark, parallel, sequence, tween, use, wait } from "../../timeline/steps";
import type { Target } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: the keyframe segments and the repeat of a `tween` step (F75), as plain data. The
// options are frozen into the step only when given, every mistake of a walk throws when the step
// is built, and a `sequence` refuses a child after one that never ends.
// ---------------------------------------------------------------------------

const chest: Target = { projection: "board.items", key: "chest" };

/** A bounce that never ends: one hop, then a pause, as the chest of the board does. */
const bounce = tween(
  chest,
  Transform,
  { y: 0, scale: 0 },
  {
    ms: 2400,
    additive: true,
    repeat: "forever",
    segments: [
      { at: 0.08, ease: "out", to: { y: -14, scale: 0.06 } },
      { at: 0.22, ease: "in", to: { y: 0, scale: 0 } },
      { at: 1, to: { y: 0, scale: 0 } }
    ]
  }
);

/**
 * Builds a straight tween of x with the given extra options.
 *
 * @param extra - The segments or the repeat to add.
 * @returns A function that builds the step, for `toThrow`.
 */
function tweenWith(extra: object): () => unknown {
  return () => tween(chest, Transform, { x: 10 }, { ms: 100, ...extra });
}

describe("anim/timeline tween — segments and repeat as data", () => {
  it("leaves both keys out of a step built without them, so its data reads as before", () => {
    const step = tween(chest, Transform, { x: 10 }, { ms: 100 });

    expect(Object.keys(step)).not.toContain("segments");
    expect(Object.keys(step)).not.toContain("repeat");
  });

  it("copies and freezes the segments, so an author's later edit never reaches a running play", () => {
    const segments = [
      { at: 0.5, ease: "in" as const, to: { x: 50 } },
      { at: 1, to: { x: 10 } }
    ];
    const step = tween(chest, Transform, { x: 10 }, { ms: 100, segments, repeat: 2 });

    segments[0] = { at: 0.5, ease: "in", to: { x: 999 } };

    expect(step).toMatchObject({
      repeat: 2,
      segments: [
        { at: 0.5, ease: "in", to: { x: 50 } },
        { at: 1, to: { x: 10 } }
      ]
    });
    expect(step.kind === "tween" && Object.isFrozen(step.segments?.[0]?.to)).toBe(true);
    expect(step.kind === "tween" && step.segments?.[1]).not.toHaveProperty("ease");
  });

  it.each([
    [
      "an empty list",
      { segments: [] },
      "[game] A tween of Transform has no segments.\n  Give it at least one segment, the last one at 1."
    ],
    [
      "an at above 1",
      { segments: [{ at: 1.2, to: { x: 10 } }] },
      "[game] A tween of Transform has a segment at 1.2.\n  Keep every at between 0 and 1."
    ],
    [
      "an at below 0",
      { segments: [{ at: -0.1, to: { x: 0 } }] },
      "[game] A tween of Transform has a segment at -0.1.\n  Keep every at between 0 and 1."
    ],
    [
      "an at that is no number",
      { segments: [{ at: Number.NaN, to: { x: 0 } }] },
      "[game] A tween of Transform has a segment at NaN.\n  Keep every at between 0 and 1."
    ],
    [
      "two segments at the same at",
      {
        segments: [
          { at: 0.5, to: { x: 0 } },
          { at: 0.5, to: { x: 5 } },
          { at: 1, to: { x: 10 } }
        ]
      },
      "[game] A tween of Transform has its segments out of order at 0.5.\n  Sort the segments by at, each one after the one before."
    ],
    [
      "a last segment before 1",
      { segments: [{ at: 0.5, to: { x: 10 } }] },
      "[game] A tween of Transform ends its last segment at 0.5.\n  End the last segment at 1: to is where the walk lands."
    ],
    [
      "a negative repeat",
      { repeat: -1 },
      '[game] A tween of Transform has repeat -1.\n  Give repeat a whole number of extra runs, 0 or more, or "forever".'
    ],
    [
      "a repeat that is no whole number",
      { repeat: 1.5 },
      '[game] A tween of Transform has repeat 1.5.\n  Give repeat a whole number of extra runs, 0 or more, or "forever".'
    ],
    [
      "a repeat that is no number",
      { repeat: Number.NaN },
      '[game] A tween of Transform has repeat NaN.\n  Give repeat a whole number of extra runs, 0 or more, or "forever".'
    ]
  ])("throws for %s when the step is built", (_case, extra, message) => {
    expect(tweenWith(extra)).toThrow(message);
  });
});

/** An animation whose tree is the bounce alone, nested by `use`. */
const chestBounce = defineAnimation("board.chestBounce", {
  slots: { chest: type<Target>() },
  build: () => bounce
});

/** The sentence a sequence throws for a child after one that never ends. */
const NEVER_ENDS =
  "[game] Step 1 of a sequence never ends, so the steps after it would never play.\n" +
  "  Put the forever step last, or run it in a parallel.";

describe("anim/timeline sequence — a step that never ends", () => {
  it("throws for a forever tween with a step after it", () => {
    expect(() => sequence(bounce, mark("after"))).toThrow(NEVER_ENDS);
  });

  it("throws for a parallel that holds one, a sequence that ends in one and a use of one", () => {
    expect(() => sequence(parallel(wait(10), bounce), wait(10))).toThrow(NEVER_ENDS);
    expect(() => sequence(sequence(wait(10), bounce), wait(10))).toThrow(NEVER_ENDS);
    expect(() => sequence(use(chestBounce, { chest }), wait(10))).toThrow(NEVER_ENDS);
  });

  it("names the step that never ends by its place", () => {
    expect(() => sequence(wait(10), bounce, mark("after"))).toThrow(
      "[game] Step 2 of a sequence never ends"
    );
  });

  it("takes a forever step last in a sequence and anywhere in a parallel", () => {
    expect(() => sequence(wait(10), bounce)).not.toThrow();
    expect(() => parallel(bounce, sequence(wait(10), mark("after")))).not.toThrow();
  });

  it("takes a step after a tween with a counted repeat: it ends", () => {
    expect(() =>
      sequence(tween(chest, Transform, { x: 1 }, { ms: 10, repeat: 3 }), wait(10))
    ).not.toThrow();
  });
});
