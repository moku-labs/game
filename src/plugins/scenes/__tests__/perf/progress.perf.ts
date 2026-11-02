import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, progressBelowStep } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the `assets:bundle-progress` hook of a switch that feeds its leave loader (F107 part 1). Every settled file of
// the switch's bundles calls it; a bundle of many files calls it far more often than it feeds the loader, so a call
// below the step keeps nothing.
// ---------------------------------------------------------------------------

describe("the progress hook of a switch, heap bytes per call", () => {
  // Bug: the hook builds the domain context, a closure or a switch for an event that does not move the progress by a
  // step, and a cold first visit of 200 files adds GC work to every file.
  it("below the step: nothing", async () => {
    const hook = await progressBelowStep();

    expect(bytesPerCall(hook)).toBeLessThanOrEqual(BUDGET.progressBelowStep + NOISE);
  });
});
