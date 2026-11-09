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

  // F159: a `when` is asked at the birth only; the frame reads the seed each view keeps.
  it("50 fades asking on views a when covers, half of them, stay within budget", async ({
    annotate
  }) => {
    const bytes = alloc(initialOnlyAsksFixture(true), 2000);

    await annotate(`initialOnly when, 50 fades asking: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.initialOnlyAsks + NOISE_BYTES);
  });

  it("a still frame after 300 views a when covers, half of them, stays within budget", async ({
    annotate
  }) => {
    const bytes = alloc(initialOnlyStillFixture(true), 2000);

    await annotate(`initialOnly when, still frame over 300 views: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.initialOnlyStill + NOISE_BYTES);
  });
});
