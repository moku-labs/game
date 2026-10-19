import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, startArcs } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: a slot timer's ring that stands still (A2 of change 2026-10-19-glass-arc). Its `Shape` is synced every pass,
// as a view in the change set is, and nothing of it changed: the drawn fields are compared and no path is built.
// ---------------------------------------------------------------------------

describe("a still arc", () => {
  // Bug: the arc's path is built again in a pass where nothing of it changed (its points, its stroke style).
  it("allocates nothing a frame: a synced ring whose value stood is not built again", async () => {
    const { mock } = await startArcs();

    expect(bytesPerCall(() => mock.modules.sync.pass())).toBeLessThanOrEqual(
      BUDGET.arcStill + NOISE
    );
  });
});
