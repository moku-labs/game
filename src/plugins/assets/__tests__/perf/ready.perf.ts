import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, readyStep } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the system `assets.ready` (F202) runs in phase `sync` of every frame of a game. At rest it reads one field;
// while a `ready` waits for the warm view the world builds aside it asks `left()` and the clock. Neither keeps a byte.
// ---------------------------------------------------------------------------

describe("the system assets.ready, heap bytes per frame", () => {
  // Bug caught: every frame of a game allocates for a wait nobody has (the A26's GC pauses come back).
  it("at rest: nothing", () => {
    expect(bytesPerCall(readyStep(false))).toBeLessThanOrEqual(BUDGET.readyRest + NOISE);
  });

  // Bug caught: the frames of a build under the dim, the ones the slice makes cheap, allocate for the wait.
  it("while a ready waits for a build under its cap: nothing", () => {
    expect(bytesPerCall(readyStep(true))).toBeLessThanOrEqual(BUDGET.readyWaiting + NOISE);
  });
});
