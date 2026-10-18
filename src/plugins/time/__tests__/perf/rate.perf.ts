import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, lateAtFloorTick, steadyTick } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: one tick of the frame source with the adaptive frame rate and its render scale (change
// 2026-10-18-memory-render B2): the governor judges the interval, grades it late, heavy and busy, and decides on the
// scale and the rate on every run frame, allocating nothing while nothing switches.
// ---------------------------------------------------------------------------

describe("a tick of the adaptive frame rate, heap bytes per tick", () => {
  it("on a steady screen at the top of the rate and the scale", () => {
    expect(bytesPerCall(steadyTick())).toBeLessThanOrEqual(BUDGET.tickSteady + NOISE);
  });

  it("on a GPU-bound screen at the floor of the rate and the scale", () => {
    expect(bytesPerCall(lateAtFloorTick())).toBeLessThanOrEqual(BUDGET.tickLateAtFloor + NOISE);
  });
});
