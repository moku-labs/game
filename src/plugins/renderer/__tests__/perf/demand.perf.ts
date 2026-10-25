import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, idleMissedMarks, markedFrame } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the change marks of a frame and the decision that empties them (audit row 20, change
// 2026-10-18-cheap-idle-tick): 20 views marked a frame, as a few tweens running, cost nothing once the lists have grown.
// ---------------------------------------------------------------------------

describe("the marks of a frame", () => {
  it("allocate nothing for 20 marks and the decision", async () => {
    expect(bytesPerCall(await markedFrame(20, false))).toBeLessThanOrEqual(
      BUDGET.demandMarks + NOISE
    );
  });

  it("allocate nothing for 20 marks and the decision with onDemand, each mark judged", async () => {
    expect(bytesPerCall(await markedFrame(20, true))).toBeLessThanOrEqual(
      BUDGET.demandMarksOnDemand + NOISE
    );
  });
});

describe("the dev missed-mark check (F69)", () => {
  it("allocates nothing on a skipped frame of 300 views with 5 stale listed writes", () => {
    expect(bytesPerCall(idleMissedMarks(300))).toBeLessThanOrEqual(
      BUDGET.demandMissedMarks + NOISE
    );
  });
});
