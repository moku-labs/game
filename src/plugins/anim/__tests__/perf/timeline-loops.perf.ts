import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET } from "./budgets";
import { bouncesFixture, heldBouncesFixture, restingBouncesFixture } from "./fixtures";

/** The bytes per call two windows of `alloc` may differ by: its own tolerance. */
const NOISE = 1;

/** A window ten times the default, so a stray compile weighs nothing in a step that keeps 0 B. */
const IDLE_CALLS = 100_000;

describe("anim endless timeline tracks: heap bytes per frame step", () => {
  it("runs 10 endless bounces keeping only the numbers that cross into world", () => {
    expect(alloc(bouncesFixture())).toBeLessThanOrEqual(BUDGET.foreverBounces + NOISE);
  });

  it("walks 10 endless bounces in their pause keeping only the read-back of the still fields", () => {
    expect(alloc(restingBouncesFixture())).toBeLessThanOrEqual(
      BUDGET.foreverBouncesResting + NOISE
    );
  });

  it("walks 10 endless bounces of views nobody sees and allocates nothing", () => {
    expect(alloc(heldBouncesFixture(), IDLE_CALLS)).toBeLessThanOrEqual(
      BUDGET.foreverBouncesHeld + NOISE
    );
  });
});
