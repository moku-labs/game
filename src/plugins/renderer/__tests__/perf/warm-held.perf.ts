import { afterEach, describe, expect, it, vi } from "vitest";
import { stepAside } from "../../sync/build";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, restingWarm } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the frame functions of the renderer while warm windows rest held (spec 33, slice B+D). A closed window keeps
// its view built and held for as long as it rests, possibly the whole session: every frame of the scene pays for it,
// so the pass and the build step must cost nothing.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Logs nothing: no view is made at rest.
 */
function silent(): void {
  // Nothing throws at rest.
}

describe("the frame functions while warm windows rest held", () => {
  // Bug: a still frame scans the held list, or takes the live half of the pass, for windows nobody opened.
  it("allocates nothing on a still pass while two windows rest held", async () => {
    const { mock } = await restingWarm(2, 300);

    expect(bytesPerCall(() => mock.modules.sync.pass())).toBeLessThanOrEqual(
      BUDGET.warmHeldPass + NOISE
    );
  });

  // Bug: the build step of a dev build runs its check of building views at rest: every view walked into a list on
  // every frame of a scene with a closed window.
  it("allocates nothing on the build step of a dev build while the windows rest", async () => {
    const { sctx } = await restingWarm(2, 300);

    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    expect(bytesPerCall(() => stepAside(sctx, silent))).toBeLessThanOrEqual(
      BUDGET.warmHeldStepDev + NOISE
    );
  });
});
