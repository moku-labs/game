import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE_BYTES } from "./budgets";
import { nestedQueryFixture, queryFixture, rowsFixture } from "./fixtures";

// `ecs.query()` outside a phase, as a game calls it every frame (Q1). Rows stay fresh, so the
// budget is the rows plus a small constant: the rest array of the call and the walk.

describe("ecs.query outside a phase: heap per call", () => {
  it("query(Cell, Lit) over 300 entities, 30 matching, stays within its rows and a constant", async ({
    annotate
  }) => {
    const rows = alloc(rowsFixture(), 2000);
    const bytes = alloc(queryFixture(), 2000);

    await annotate(`query: ${bytes} B a call, its 30 rows alone ${rows} B`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.queryOutside + NOISE_BYTES);
  });

  it("a query nested in a query's loop stays within budget", async ({ annotate }) => {
    const bytes = alloc(nestedQueryFixture(), 1000);

    await annotate(`nested query: ${bytes} B a call (5 outer rows, 5 x 30 inner rows)`);
    expect(bytes).toBeLessThanOrEqual(BUDGET.queryNested + NOISE_BYTES);
  });
});
