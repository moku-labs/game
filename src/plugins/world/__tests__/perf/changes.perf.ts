import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { changedIdleFixture, marksFixture, settled } from "./fixtures";

describe("change sets: heap per frame", () => {
  it("100 marks and the clear stay within budget", async ({ annotate }) => {
    const bytes = alloc(marksFixture(), 2000);

    await annotate(`changes, 100 marks + clear: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.changesMarkClear + NOISE_BYTES);
  });

  it("changed() of a component nothing marked, walked, stays within budget", async ({
    annotate
  }) => {
    const bytes = alloc(settled(changedIdleFixture()));

    await annotate(`changes, changed() idle: ${bytes} B a call`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.changedIdle + NOISE_BYTES);
  });
});
