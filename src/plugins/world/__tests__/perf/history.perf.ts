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
});
