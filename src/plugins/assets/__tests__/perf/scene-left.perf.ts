import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, exitEndNothingLeaves, exitEndStillExiting } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the check `assets` runs every time an element loses `Exiting` (change 2026-10-21-enter-pose-bundle-hold,
// F51). A leave ends hundreds of exits in a few frames, so the check keeps nothing.
// ---------------------------------------------------------------------------

describe("the end of an exit, heap bytes per call", () => {
  it("while no scene leaves: nothing", () => {
    expect(bytesPerCall(exitEndNothingLeaves())).toBeLessThanOrEqual(BUDGET.nothingLeaves + NOISE);
  });

  it("while a scene leaves and another element still exits: nothing", () => {
    expect(bytesPerCall(exitEndStillExiting())).toBeLessThanOrEqual(BUDGET.stillExiting + NOISE);
  });
});
