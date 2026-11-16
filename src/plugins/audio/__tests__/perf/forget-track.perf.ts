import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, forgetLeft, forgetPlaying, mapChurn } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the cache drop a music switch makes (F198). It runs once per switch, so a leak per call would stay small;
// the test still holds it to nothing.
// ---------------------------------------------------------------------------

describe("forgetTrack, heap bytes per call", () => {
  it("keeps the track that plays: nothing", () => {
    expect(bytesPerCall(forgetPlaying())).toBeLessThanOrEqual(BUDGET.forgetPlaying + NOISE);
  });

  it("drops a key that left: nothing beyond the Map's own churn of the put-back", () => {
    const churn = bytesPerCall(mapChurn());

    expect(bytesPerCall(forgetLeft())).toBeLessThanOrEqual(churn + BUDGET.forgetLeft + NOISE);
  });
});
