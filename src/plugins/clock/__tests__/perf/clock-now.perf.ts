import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, stillReadIntoField, systemReadIntoField } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: `clock.now()` per read, as `world` reads it every frame into its `Now` resource (change
// 2026-10-18-cheap-idle-tick): epoch milliseconds are no small integer, so a read may box a number.
// ---------------------------------------------------------------------------

describe("clock.now(), heap bytes per read", () => {
  it("over the system source: the device clock's box, nothing of the clock", () => {
    expect(bytesPerCall(systemReadIntoField())).toBeLessThanOrEqual(BUDGET.systemNow + NOISE);
  });

  it("over a still source: the clock's own code keeps nothing", () => {
    expect(bytesPerCall(stillReadIntoField())).toBeLessThanOrEqual(BUDGET.stillNow + NOISE);
  });
});
