import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, lookupHit } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the hit path of the texture provider (change 2026-11-15-f184-budget-drawn). `renderer` asks it for every view
// after an invalidate, a scene full of sprites at once; F184 changed only the miss path, so the hit keeps nothing.
// ---------------------------------------------------------------------------

describe("lookupTexture, heap bytes per call", () => {
  // Bug: the loop guard moves into the hit path, or the hit builds a key list or a closure per call.
  it("a key of a loaded bundle: nothing", async () => {
    expect(bytesPerCall(await lookupHit())).toBeLessThanOrEqual(BUDGET.lookupHit + NOISE);
  });
});
