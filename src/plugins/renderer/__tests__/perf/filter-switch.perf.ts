import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, filteredStage } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the frame's step that hands Pixi a filter switched on or off (E3 of change 2026-10-18-render-path-garbage).
// Pixi holds only the enabled filters, so the step compares every filtered view with what it holds: with nothing
// switched it costs nothing.
// ---------------------------------------------------------------------------

describe("the filter switch step", () => {
  it("allocates nothing for 12 views whose filters are switched off and stay so", async () => {
    const mock = await filteredStage(false);

    expect(bytesPerCall(() => mock.modules.sync.stepFilters())).toBeLessThanOrEqual(
      BUDGET.filterSwitchStill + NOISE
    );
  });

  it("allocates nothing for 12 views whose filters are on and stay so", async () => {
    const mock = await filteredStage();

    expect(bytesPerCall(() => mock.modules.sync.stepFilters())).toBeLessThanOrEqual(
      BUDGET.filterSwitchStill + NOISE
    );
  });
});
