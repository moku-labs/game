import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { sweepFixture } from "./fixtures";

describe("projection sweep: heap per frame", () => {
  it("a sweep over 300 resting views stays within budget", async ({ annotate }) => {
    const bytes = alloc(sweepFixture(0), 2000);

    await annotate(`sweep, 300 resting views: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.sweepIdle + NOISE_BYTES);
  });

  it("a sweep with 10 tracks ending stays within budget", async ({ annotate }) => {
    const bytes = alloc(sweepFixture(10), 2000);

    await annotate(`sweep, 10 tracks ending: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.sweepTracksEnding + NOISE_BYTES);
  });
});
