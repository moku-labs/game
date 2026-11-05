import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { walkFixture } from "./fixtures";

// The alloc twins of the old probe `integration/query-allocation.test.ts` (spec 26 W1.6): 40
// systems over 300 entities, ten of them with a `mut()` term. One call is one frame.

describe("world walk: heap per frame", () => {
  it("an idle frame of 40 systems over 300 entities, 30 matching, stays within budget", async ({
    annotate
  }) => {
    const bytes = alloc(walkFixture(30), 1000);

    await annotate(`world walk, 30 matching: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.worldWalkIdle + NOISE_BYTES);
  }, 60_000);

  it("the same frame with all 300 entities matching stays within budget", async ({ annotate }) => {
    const bytes = alloc(walkFixture(300), 100);

    await annotate(`world walk, 300 matching: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.worldWalkAllMatch + NOISE_BYTES);
  }, 60_000);

  // Bug caught (F155): the pass over a scene built aside copies the build's set or makes a closure per run.
  it("the frame of 40 feature systems while half the entities are built aside keeps nothing", async ({
    annotate
  }) => {
    const bytes = alloc(walkFixture(300, true), 100);

    await annotate(`world walk, feature systems during a build aside: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.worldWalkAllMatch + NOISE_BYTES);
  }, 60_000);
});
