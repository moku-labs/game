import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, lastAnswer, plainTap } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the press point of a tap answer (F139) is opt-in. A view without `point` keeps the one answer object it kept
// before the point existed, also when a point is in hand.
// ---------------------------------------------------------------------------

describe("the tap answer, heap bytes per call", () => {
  // Bug caught: the payload is copied or a point object is built for a view that never asked for the point.
  it("keeps only the answer object for a view without the point flag", () => {
    expect(bytesPerCall(plainTap())).toBeLessThanOrEqual(BUDGET.plainTap + NOISE);
    expect(lastAnswer()).toEqual({ intent: "found", payload: { id: "lamp" } });
  });
});
