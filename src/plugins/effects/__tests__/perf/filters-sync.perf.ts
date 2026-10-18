import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import {
  bytesPerCall,
  CROSSING,
  fadeStep,
  fadeWrite,
  filtersFixture,
  HALF,
  RESTING,
  tweenStep,
  tweenWrite
} from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the filter sync of `effects` (change 2026-10-18-cheap-idle-tick, E1) — 12 filtered views with
// nothing changed, one uniform tweened on one of them, and one Alpha fading (change 2026-10-18-memory-render, M4).
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

  it.each([
    ["touching 1 in every other step: its filter stays on", CROSSING, BUDGET.filtersFadeCrossing],
    [
      "resting at 1 until its filter is switched off, then fading in",
      RESTING,
      BUDGET.filtersFadeResting
    ],
    ["at resolution 0.5", HALF, BUDGET.filtersFadeHalf]
  ] as const)("one Alpha of 12 filtered views fading, %s", (_name, fade, budget) => {
    const fixture = filtersFixture();
    const asked = fixture.counter.invalidated;
    const step = bytesPerCall(fadeStep(fixture, fade));
    // The fade's own write of the alpha into the stored value: not the sync's bytes.
    const write = bytesPerCall(fadeWrite(fixture, fade));

    // The moves of the fade are drawn: the renderer was asked for their frames.
    expect(fixture.counter.invalidated).toBeGreaterThan(asked);
    expect(step - write).toBeLessThanOrEqual(budget + NOISE);
  });
});
