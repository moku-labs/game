import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, returnBoard, returnCycleBoard } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf (change 2026-11-25-f240-hud-return): what the overlay step allocates per frame with a HUD return, after its
// warm-up, each step handed a frame of 16 ms of game time. (a) A landed overlay whose `hudReturn` has three keys in
// `parts`: the value is compared by reference, copied only when a write gives a new one. (a2) The same value written
// again before every step as a new object with the same times (an inline literal): compared field by field, the copy
// kept. (b) A run in progress after its record is gone, three parts held: time counted in place, three products by
// index. (c) The same run over, back in the pool: the step of a scene with no run. (d) A run in its fade: every step
// draws the three parts at a new factor between 0 and 1. (e) A run started from the warm pool and ended again, a leave
// and a return of the overlay a call. (e2) The cycle of (e) under reduced motion. (f) The run of (b) in frames the clock
// marks idle: every step wakes the clock.
// ---------------------------------------------------------------------------

describe("the overlay step with a HUD return", () => {
  it("steps a landed overlay with hudReturn and three keys in parts without allocating", async () => {
    const { step } = await returnBoard("standing");

    expect(bytesPerCall(step, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnStanding + NOISE);
  });

  // Bug: a new reference with the same times is copied and clamped again: a Map and its objects every frame.
  it("steps an overlay whose hudReturn is written again as an equal new object every frame without allocating", async () => {
    const { step } = await returnBoard("rewritten");

    expect(bytesPerCall(step, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnRewritten + NOISE);
  });

  it("steps a run in progress after its record is gone, three parts held, without allocating", async () => {
    const { step } = await returnBoard("running");

    expect(bytesPerCall(step, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnRunning + NOISE);
  });

  it("steps three parts after the run ended, its object back in the pool, without allocating", async () => {
    const { step } = await returnBoard("ended");

    expect(bytesPerCall(step, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnEnded + NOISE);
  });

  // Bug: a factor between 0 and 1 boxes a number or builds an object for each part it writes.
  it("steps a run in its fade, three parts drawn at a new factor every frame, without allocating", async () => {
    const { step } = await returnBoard("fading");

    expect(bytesPerCall(step, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnFading + NOISE);
  });

  // Bug: a run start makes a new object, or the list of runs cut to 0 gives the next start a new backing store.
  it("starts a run from the warm pool and ends it again, a leave and a return a call, without allocating", async () => {
    const cycle = await returnCycleBoard();

    expect(bytesPerCall(cycle, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnCycle + NOISE);
  });

  // Bug: the walk of a reduced-motion end takes another way (a closure for the fade cut, a list of the delays) that
  // allocates at each leave.
  it("starts a run under reduced motion from the warm pool and ends it again without allocating", async () => {
    const cycle = await returnCycleBoard(true);

    expect(bytesPerCall(cycle, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnCycleReduced + NOISE);
  });

  // Bug: the wake of an idle frame builds something (a closure, a reason) at each call.
  it("steps a run in its delay in frames the clock marks idle, waking it each frame, without allocating", async () => {
    const { step } = await returnBoard("idle");

    expect(bytesPerCall(step, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnIdle + NOISE);
  });

  // F245. Bug: an eased factor or a sampled pose boxes a double (a curve called with a number and returning one, a
  // field read through a returned value), or the pose is handed over as a new object per part.
  it("steps a run with a curve, a tuple in parts and a three-key walk, three poses drawn, without allocating", async () => {
    const { step } = await returnBoard("walking");

    expect(bytesPerCall(step, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnWalking + NOISE);
  });

  // F245. Bug: the compare of an equal new value misses the curves or the keys and copies again: a bezier table solved
  // and the keys flattened at every render of an inline literal.
  it("steps an overlay whose motion value is written again as an equal new object every frame without allocating", async () => {
    const { step } = await returnBoard("walkRewritten");

    expect(bytesPerCall(step, 20_000)).toBeLessThanOrEqual(BUDGET.hudReturnWalkRewritten + NOISE);
  });
});
