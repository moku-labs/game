import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import {
  bytesPerCall,
  leaveOtherScene,
  leaveTwoLoops,
  leaveWithoutLoops,
  loopChurn,
  sameLoop
} from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the two checks of a loop (F239). `stopSceneLoops` runs on every `scenes:changed`, `isSameLoop` on every loop
// request; neither runs per frame, and the tests still hold both to nothing.
// ---------------------------------------------------------------------------

describe("stopSceneLoops, heap bytes per call", () => {
  it("leaves a scene no loop belongs to: nothing", () => {
    expect(bytesPerCall(leaveWithoutLoops())).toBeLessThanOrEqual(BUDGET.leaveWithoutLoops + NOISE);
  });

  it("walks two loops of another scene and stops neither: nothing", () => {
    expect(bytesPerCall(leaveOtherScene())).toBeLessThanOrEqual(BUDGET.leaveOtherScene + NOISE);
  });

  it("stops the two loops of the scene that leaves: nothing beyond the Maps' own churn of the put-back", () => {
    const churn = bytesPerCall(loopChurn());

    expect(bytesPerCall(leaveTwoLoops())).toBeLessThanOrEqual(churn + BUDGET.leaveTwoLoops + NOISE);
  });
});

describe("isSameLoop, heap bytes per call", () => {
  it("finds the bed that already plays under the id: nothing", () => {
    expect(bytesPerCall(sameLoop())).toBeLessThanOrEqual(BUDGET.sameLoop + NOISE);
  });
});
