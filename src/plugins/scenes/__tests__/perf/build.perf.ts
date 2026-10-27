import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { buildWaiting, bytesPerCall, reactionWaiting } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the `signals` callback of a scene built aside (spec 31, F61 S2), which every frame of a build runs until the
// world says it is done. A build lasts some frames on a phone, so the callback keeps nothing.
// ---------------------------------------------------------------------------

describe("the frame callback of a scene build, heap bytes per call", () => {
  // Bug: the callback makes a closure, a payload or a list each frame it finds the build not done.
  it("while the build is not done: nothing", async () => {
    const frame = await buildWaiting();

    expect(bytesPerCall(frame)).toBeLessThanOrEqual(BUDGET.buildWaiting + NOISE);
  });

  // Bug: the callback of a switch waiting for its reaction frame allocates each frame it finds the frame not drawn.
  it("while the reaction frame is not drawn: nothing", async () => {
    const frame = await reactionWaiting();

    expect(bytesPerCall(frame)).toBeLessThanOrEqual(BUDGET.reactionWaiting + NOISE);
  });
});
