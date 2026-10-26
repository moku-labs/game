import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { initialOnlyAsksFixture, initialOnlyStillFixture } from "./fixtures";

describe("initialOnly: heap per frame", () => {
  it("50 fades asking for the muted fields of their initialOnly views stay within budget", async ({
    annotate
  }) => {
    const bytes = alloc(initialOnlyAsksFixture(), 2000);

    await annotate(`initialOnly, 50 fades asking: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.initialOnlyAsks + NOISE_BYTES);
  });

  it("a still frame after 300 initialOnly views ended their fade stays within budget", async ({
    annotate
  }) => {
    const bytes = alloc(initialOnlyStillFixture(), 2000);

    await annotate(`initialOnly, still frame over 300 views: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.initialOnlyStill + NOISE_BYTES);
  });
});
