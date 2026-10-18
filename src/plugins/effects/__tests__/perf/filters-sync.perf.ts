import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import {
  bytesPerCall,
  fadeStep,
  fadeWrite,
  filtersFixture,
  tweenStep,
  tweenWrite
} from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the filter sync of `effects` (change 2026-10-18-cheap-idle-tick, E1) — 12 filtered views with
// nothing changed, one uniform tweened on one of them, and one Alpha crossing 1 (change 2026-10-18-memory-render, M4).
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

  it("one Alpha crossing 1 on one of 12 filtered views: its filter switched off and on", () => {
    const fixture = filtersFixture();
    const asked = fixture.counter.invalidated;
    const step = bytesPerCall(fadeStep(fixture));
    // The fade's own write of the alpha into the stored value: not the sync's bytes.
    const write = bytesPerCall(fadeWrite(fixture));

    // Every step wrote the switch the player sees: the renderer was asked for its frame.
    expect(fixture.counter.invalidated).toBeGreaterThan(asked);
    expect(step - write).toBeLessThanOrEqual(BUDGET.filtersFade + NOISE);
  });
});
