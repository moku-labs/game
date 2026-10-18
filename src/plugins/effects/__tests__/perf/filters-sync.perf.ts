import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, filtersFixture, tweenStep, tweenWrite } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the filter sync of `effects` (change 2026-10-18-cheap-idle-tick, E1) — 12 filtered views with
// nothing changed, and one uniform tweened on one of them.
// ---------------------------------------------------------------------------

describe("effects:filters, heap bytes per frame step", () => {
  it("12 filtered views, nothing changed", () => {
    const { run } = filtersFixture();

    expect(bytesPerCall(run)).toBeLessThanOrEqual(BUDGET.filtersIdle + NOISE);
  });

  it("one Glow strength tweened on one of 12 filtered views", () => {
    const fixture = filtersFixture();
    const step = bytesPerCall(tweenStep(fixture));
    // The tween's own write of a fraction into the stored value: not the sync's bytes.
    const write = bytesPerCall(tweenWrite(fixture));

    expect(step - write).toBeLessThanOrEqual(BUDGET.filtersTween + NOISE);
  });
});
