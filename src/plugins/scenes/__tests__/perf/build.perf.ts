import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { buildWaiting, bytesPerCall, loaderFading } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the `signals` callback of a scene built aside (spec 31, F61 S2), which every frame of a build runs until the
// world says it is done. A build lasts some frames on a phone, so the callback keeps nothing. And the `signals` callback
// of a loader projection fading out with the veil after a swap (F107 part 3), every frame of the fade.
// ---------------------------------------------------------------------------

describe("the frame callback of a scene build, heap bytes per call", () => {
  // Bug: the callback makes a closure, a payload or a list each frame it finds the build not done.
  it("while the build is not done: nothing", async () => {
    const frame = await buildWaiting();

    expect(bytesPerCall(frame)).toBeLessThanOrEqual(BUDGET.buildWaiting + NOISE);
  });
});

describe("the frame callback of a loader fading out, heap bytes per call", () => {
  // Bug: the fade's callback makes an object or a closure each frame of the veil's fade-out (F107 part 3).
  it("while the veil fades out: nothing", async () => {
    const frame = await loaderFading();

    expect(bytesPerCall(frame)).toBeLessThanOrEqual(BUDGET.loaderFading + NOISE);
  });
});
