import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, preloadStep } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the system `assets.preload` (F230) runs in phase `sync` of every frame of a game. With no rest waiting it reads
// one field; while a rest waits for the world to stop playing it asks `left()` and the clock. Neither keeps a byte.
// ---------------------------------------------------------------------------

describe("the system assets.preload, heap bytes per frame", () => {
  // Bug caught: every frame of a game allocates for a walk nobody waits for.
  it("no rest waits: nothing", () => {
    expect(bytesPerCall(preloadStep(false))).toBeLessThanOrEqual(BUDGET.preloadRest + NOISE);
  });

  // Bug caught: the animation frames after a merge allocate while the walk waits for them to end.
  it("a rest waits while the world plays: nothing", () => {
    expect(bytesPerCall(preloadStep(true))).toBeLessThanOrEqual(BUDGET.preloadWaiting + NOISE);
  });
});
