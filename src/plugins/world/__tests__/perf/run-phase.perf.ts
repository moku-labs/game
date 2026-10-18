import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { phasesFixture } from "./fixtures";

describe("run phase: heap per frame", () => {
  it("a frame of 4 phases with 40 empty-query systems each stays within budget", async ({
    annotate
  }) => {
    const bytes = alloc(phasesFixture(), 1000);

    await annotate(`run phase, 4 x 40 systems: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.runPhaseFrame + NOISE_BYTES);
  });
});
