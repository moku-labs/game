import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, returnBoard } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf (change 2026-11-25-f240-hud-return): what the overlay step allocates per frame with a HUD return, after its
// warm-up. (a) A landed overlay whose `hudReturn` has three keys in `parts`: the value is compared by reference, copied
// only when a write gives a new one. (b) A run in progress after its record is gone, three parts held: time counted in
// place, three products by index. (c) The same run over, back in the pool: the step of a scene with no run.
// ---------------------------------------------------------------------------

describe("the overlay step with a HUD return", () => {
  it("steps a landed overlay with hudReturn and three keys in parts without allocating", async () => {
    const { step } = await returnBoard("standing");

    expect(bytesPerCall(step, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnStanding + NOISE);
  });

  it("steps a run in progress after its record is gone, three parts held, without allocating", async () => {
    const { step } = await returnBoard("running");

    expect(bytesPerCall(step, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnRunning + NOISE);
  });

  it("steps three parts after the run ended, its object back in the pool, without allocating", async () => {
    const { step } = await returnBoard("ended");

    expect(bytesPerCall(step, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnEnded + NOISE);
  });
});
