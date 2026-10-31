import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { buildHeld, buildWaiting, bytesPerCall, loaderFading } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the `signals` callback of a scene built aside (spec 31, F61 S2), which every frame of a build runs until the
// world says it is done. A build lasts some frames on a phone, so the callback keeps nothing, also while a floor holds the
// built scene (F130). And the `signals` callback of a loader projection fading out with the veil after a swap (F107
// part 3), every frame of the fade.
// ---------------------------------------------------------------------------

describe("the frame callback of a scene build, heap bytes per call", () => {
  // Bug: the callback makes a closure, a payload or a list each frame it finds the build not done.
  it("while the build is not done: nothing", async () => {
    const frame = await buildWaiting();

    expect(bytesPerCall(frame)).toBeLessThanOrEqual(BUDGET.buildWaiting + NOISE);
  });

  // Bug: the wait reads `time.snapshot()`, which copies, or makes an object each frame of the floor (F130).
  it("while a floor holds the built scene: nothing", async () => {
    const frame = await buildHeld();

    expect(bytesPerCall(frame)).toBeLessThanOrEqual(BUDGET.buildHeld + NOISE);
  });
});

describe("the frame callback of a loader fading out, heap bytes per call", () => {
  // Bug: the fade's callback makes an object or a closure each frame of the veil's fade-out (F107 part 3).
  it("while the veil fades out: nothing", async () => {
    const frame = await loaderFading();

    expect(bytesPerCall(frame)).toBeLessThanOrEqual(BUDGET.loaderFading + NOISE);
  });
});
