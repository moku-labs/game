import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { scopeCheckFixture, scopedFixture, settled } from "./fixtures";

describe("scoped systems: heap per frame (spec 28)", () => {
  // Bug caught: a sleeping system still walks, marks or allocates, so a game pays for systems of
  // screens it does not show.
  it("40 systems of an inactive feature are not run and the frame keeps nothing", async ({
    annotate
  }) => {
    const fixture = scopedFixture("active");
    const bytes = alloc(settled(fixture.frame), 1000);

    await annotate(`scope, 40 sleeping systems: ${bytes} B a frame`);
    expect(fixture.runs()).toBe(0);
    expect(bytes).toBeLessThanOrEqual(BUDGET.scopeInactive + NOISE_BYTES);
  });

  // Bug caught: the evaluation of the active set makes an array or a closure per phase.
  it("the check of 20 features after a move of the flow keeps nothing", async ({ annotate }) => {
    const bytes = alloc(settled(scopeCheckFixture()), 1000);

    await annotate(`scope, 20 features evaluated: ${bytes} B a frame`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.scopeCheck + NOISE_BYTES);
  });
});
