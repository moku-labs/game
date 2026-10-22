import { describe, expect, it } from "vitest";
import { createMockRenderer } from "../mock-renderer";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the upload step of a drawn frame (F60 of change 2026-10-22-ready-warm-hollow) with nothing queued: what every
// frame of a game pays once its textures are on the GPU.
// ---------------------------------------------------------------------------

describe("the upload step", () => {
  // Bug: an idle step walks or builds something every frame (the queue, the waiting calls, a closure).
  it("allocates nothing a frame with an empty queue", async () => {
    const mock = createMockRenderer();

    await mock.start();

    expect(bytesPerCall(() => mock.modules.sync.uploadStep())).toBeLessThanOrEqual(
      BUDGET.uploadIdle + NOISE
    );
  });
});
