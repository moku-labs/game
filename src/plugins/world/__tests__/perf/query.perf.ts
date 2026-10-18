import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, QUERY_MARGIN } from "./budgets";
import { nestedQueryFixture, queryFixture, rowsFixture, settled } from "./fixtures";

// `ecs.query()` outside a phase, as a game calls it every frame (Q1). Rows stay fresh, so the
// budget is relative: the rows measured here, in the same process, plus `queryWalk` bytes per
// walk and `QUERY_MARGIN`. Each fixture runs well past `alloc`'s own warm-up first, so V8 has
// settled its tiers and the two windows of `alloc` measure the same code.

describe("ecs.query outside a phase: heap per call", () => {
  it("query(Cell, Lit) over 300 entities, 30 matching, keeps its rows and one walk", async ({
    annotate
  }) => {
    const rows = alloc(settled(rowsFixture(30)), 2000);
    const bytes = alloc(settled(queryFixture()), 2000);
    const budget = rows + BUDGET.queryWalk + QUERY_MARGIN;
    const report = `query: measured ${bytes} B a call, budget ${budget} B (30 rows ${rows} B + 1 walk ${BUDGET.queryWalk} B + margin ${QUERY_MARGIN} B)`;

    await annotate(report);
    expect(bytes, report).toBeLessThanOrEqual(budget);
  }, 60_000);

  it("a query nested in a query's loop keeps its rows and six walks", async ({ annotate }) => {
    const rows = alloc(settled(rowsFixture(150, 5)), 1000);
    const bytes = alloc(settled(nestedQueryFixture()), 1000);
    const budget = rows + 6 * BUDGET.queryWalk + QUERY_MARGIN;
    const report = `nested query: measured ${bytes} B a call, budget ${budget} B (155 rows ${rows} B + 6 walks + margin ${QUERY_MARGIN} B)`;

    await annotate(report);
    expect(bytes, report).toBeLessThanOrEqual(budget);
  }, 60_000);
});
