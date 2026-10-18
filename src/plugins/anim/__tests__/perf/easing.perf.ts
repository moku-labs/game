import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET } from "./budgets";
import { bezierFixture } from "./fixtures";

/** The bytes per call two windows of `alloc` may differ by: its own tolerance. */
const NOISE = 1;

/** A window ten times the default, so a stray compile weighs nothing in a call that keeps 0 B. */
const CALLS = 100_000;

describe("anim easing: heap bytes per eased time", () => {
  it("eases on a design curve made by cubicBezier and allocates nothing", () => {
    expect(alloc(bezierFixture([0.22, 0.61, 0.36, 1]), CALLS)).toBeLessThanOrEqual(
      BUDGET.cubicBezier + NOISE
    );
  });

  it("eases on a curve that leaves vertically, its first interval solved, and allocates nothing", () => {
    expect(alloc(bezierFixture([0, 0.55, 0.45, 1]), CALLS)).toBeLessThanOrEqual(
      BUDGET.cubicBezier + NOISE
    );
  });
});
