import { afterEach, describe, expect, it, vi } from "vitest";
import { trailFrame } from "../../trail";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";
import { trailStage } from "./trail-fixtures";

// ---------------------------------------------------------------------------
// Perf: the trail of the run (F175) on the per-frame path. The render callback of a drawn frame counts it for the
// trail's next write; the write itself runs on a 2 s timer, never in a frame.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the trail of the run, per frame", () => {
  // Bug: the count boxes a number or builds a record every frame.
  it("counts a drawn frame that uploaded without allocating", async () => {
    const { mock } = await trailStage(true);
    const trail = mock.ctx.state.trail;

    expect(bytesPerCall(() => trailFrame(trail, true))).toBeLessThanOrEqual(
      BUDGET.trailFrame + NOISE
    );
    mock.stop();
  });

  // Bug: a started trail writes or reads the storage, reads the clock or fills the record in the frame.
  it("adds nothing to a drawn frame of 20 sprites", async () => {
    const bare = await trailStage(false);
    const without = bytesPerCall(() => bare.mock.drawFrame(), 20_000);

    bare.mock.stop();

    const kept = await trailStage(true);
    const withTrail = bytesPerCall(() => kept.mock.drawFrame(), 20_000);

    expect(kept.mock.ctx.state.trail.frames).toBeGreaterThan(0);
    kept.mock.stop();
    expect(withTrail - without).toBeLessThanOrEqual(BUDGET.trailDrawnFrame + NOISE);
  });
});
