import { describe, expect, it } from "vitest";
import { buildReady } from "../../sync/build";
import { createMockRenderer } from "../mock-renderer";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, waitingBuild } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the frame functions of a scene built aside (spec 31, F61 S2) on their idle paths. The still pass with no build
// is `sync-pass.perf.ts`; here the pass while a build waits for its swap, the pre-draw step with and without a build,
// and the renderer's readiness check that `world.projection.built()` asks every build frame.
// ---------------------------------------------------------------------------

describe("the frame functions of a scene build", () => {
  // Bug: a still frame of a build walks the held views, copies a list, or makes a closure for the aside queue: every
  // build frame pays for the views it is not making.
  it("allocates nothing on a still pass while the built views wait for the swap", async () => {
    const { mock } = await waitingBuild(40);

    expect(mock.ctx.state.sync.heldViews.count).toBe(40);
    expect(bytesPerCall(() => mock.modules.sync.pass())).toBeLessThanOrEqual(
      BUDGET.buildPassWaiting + NOISE
    );
  });

  // Bug: the pre-draw step of every drawn frame builds a queue, a closure or a target with no build at all.
  it("allocates nothing on the pre-draw step with no build", async () => {
    const mock = createMockRenderer();

    await mock.start();

    expect(bytesPerCall(() => mock.modules.sync.predrawStep())).toBeLessThanOrEqual(
      BUDGET.predrawIdle + NOISE
    );
  });

  // Bug: the pre-draw step cuts the held tops again, or walks them, in every frame after it drew them all.
  it("allocates nothing on the pre-draw step once every held view is pre-drawn", async () => {
    const { mock } = await waitingBuild(40);

    expect(bytesPerCall(() => mock.modules.sync.predrawStep())).toBeLessThanOrEqual(
      BUDGET.predrawWaiting + NOISE
    );
  });

  // Bug: the readiness check walks a set with an iterator, or the held list, at every poll of `built()`.
  it("allocates nothing on the readiness check while the views wait for the swap", async () => {
    const { sctx } = await waitingBuild(40);

    expect(buildReady(sctx)).toBe(true);
    expect(bytesPerCall(() => buildReady(sctx))).toBeLessThanOrEqual(
      BUDGET.buildReadyWaiting + NOISE
    );
  });
});
