import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, startHollows } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: a hollow frame (F59 of change 2026-10-22-ready-warm-hollow) synced every pass, as a view in the change set is:
// standing still it writes nothing, and resized it rewrites its vertices in the arrays it has.
// ---------------------------------------------------------------------------

describe("a hollow nine-slice", () => {
  // Bug: a nine-slice write builds objects while nothing changed (a texture answer, the borders, the hit box, the
  // outline's shape, the clip's box).
  it("allocates nothing a frame when its value stood", async () => {
    const { mock } = await startHollows();

    expect(bytesPerCall(() => mock.modules.sync.pass())).toBeLessThanOrEqual(
      BUDGET.hollowStill + NOISE
    );
  });

  // Bug: a resize makes a new vertex array, or a new hit box, every frame of a size tween.
  it("allocates nothing a frame when its width changes", async () => {
    const { mock, panel } = await startHollows();

    expect(
      bytesPerCall(() => {
        panel.width = panel.width === 300 ? 301 : 300;
        mock.modules.sync.pass();
      })
    ).toBeLessThanOrEqual(BUDGET.hollowResize + NOISE);
  });
});
