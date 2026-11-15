import { describe, expect, it } from "vitest";
import { createMockRenderer } from "../mock-renderer";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";
import { waitingSources } from "./release-fixtures";

// ---------------------------------------------------------------------------
// Perf: the release step after a drawn frame (F189): what every frame pays with no decoded image waiting, and with a
// preloaded bundle whose images Pixi has not uploaded yet.
// ---------------------------------------------------------------------------

describe("the release step", () => {
  // Bug: an idle step walks or builds something every frame.
  it("allocates nothing a frame with nothing waiting", async () => {
    const mock = createMockRenderer();

    await mock.start();

    expect(bytesPerCall(() => mock.modules.sync.releaseStep())).toBeLessThanOrEqual(
      BUDGET.releaseIdle + NOISE
    );
  });

  // Bug: the sources that keep waiting are copied into a new list every frame.
  it("allocates nothing a frame while 40 images wait for their upload", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.ctx.state.sync.release.pending.push(...waitingSources(40));

    expect(bytesPerCall(() => mock.modules.sync.releaseStep())).toBeLessThanOrEqual(
      BUDGET.releaseWaiting + NOISE
    );
    expect(mock.ctx.state.sync.release.pending).toHaveLength(40);
  });
});
