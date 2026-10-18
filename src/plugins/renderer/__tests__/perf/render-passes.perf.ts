import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, filteredStage, hudStage } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: what a still frame reads every frame after the A26 device profile (Q2 of change 2026-10-18-cheap-idle-tick):
// the render passes `effects` checks its budget with, and the overlay step's HUD parts. Both cost nothing still.
// ---------------------------------------------------------------------------

describe("a still frame", () => {
  it("reads the render passes of 12 filtered views without allocating", async () => {
    const mock = await filteredStage();

    expect(bytesPerCall(() => mock.api.sync.renderPasses())).toBeLessThanOrEqual(
      BUDGET.renderPassesStill + NOISE
    );
  });

  it("steps the HUD parts of a scene without an overlay without allocating", async () => {
    const mock = await hudStage();

    expect(bytesPerCall(() => mock.modules.sync.stepOverlays())).toBeLessThanOrEqual(
      BUDGET.hudPartsStill + NOISE
    );
  });
});
