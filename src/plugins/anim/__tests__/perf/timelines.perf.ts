import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET } from "./budgets";
import { timelinesFixture, waitingTimelinesFixture } from "./fixtures";

/** The bytes per call two windows of `alloc` may differ by: its own tolerance. */
const NOISE = 1;

/** A window ten times the default, so a stray compile weighs nothing in a step that keeps 0 B. */
const IDLE_CALLS = 100_000;

describe("anim timelines: heap bytes per frame step", () => {
  it("walks 10 waiting timelines and allocates nothing", () => {
    expect(alloc(waitingTimelinesFixture(), IDLE_CALLS)).toBeLessThanOrEqual(
      BUDGET.timelinesWaiting + NOISE
    );
  });

  it("runs 10 timelines keeping only the numbers that cross into world", () => {
    expect(alloc(timelinesFixture())).toBeLessThanOrEqual(BUDGET.timelines + NOISE);
  });
});
