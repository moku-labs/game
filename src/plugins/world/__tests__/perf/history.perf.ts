import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { recordedFrameFixture, settled } from "./fixtures";

describe("the frame history: heap per frame (F70)", () => {
  it("a recorded frame of 20 moved Spots stays within budget", async ({ annotate }) => {
    const bytes = alloc(settled(recordedFrameFixture()), 2000);

    await annotate(`history, 20 moved Spots: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.historyFrame + NOISE_BYTES);
  });

  // Bug (F194): a slot over the spare floor scans the ring for the busiest frame and cuts its spares, every frame: the
  // scan or the cut must not allocate, and a steady busy board must keep the spares it reuses.
  it("a recorded frame of 200 moved Spots, over the spare floor, stays within budget", async ({
    annotate
  }) => {
    const bytes = alloc(settled(recordedFrameFixture(400, 200)), 2000);

    await annotate(`history, 200 moved Spots: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.historyBusyFrame + NOISE_BYTES);
  });
});
