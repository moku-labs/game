import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET } from "./budgets";
import { buildInline, resolveDefined, resolveInline } from "./resolve.fixture";

// ---------------------------------------------------------------------------
// Change 2026-11-27-hp-2ab-style-layout. `resolve` of a row style with a padding per edge, a `when` and an `is`
// variant, for a pressed element (Node 24.21, warm `alloc`). The merge used a rest copy of the style and an entries
// array per variant, and copied every padding. Now it walks the fields with for-in and hands the frozen edges of a
// defined style out as they are: what is left is the resolved object, and a frozen copy of inline edges. Before the
// change: 1 401 B defined, 889 B inline; now 96 B and 424 B. Bench mean: 0.87 → 0.25 µs defined, 1.03 → 0.39 µs inline.
// ---------------------------------------------------------------------------

describe("resolve: heap per call", () => {
  it("keeps the resolved object only, and a copy of the edges a game wrote inline", async ({
    annotate
  }) => {
    // Bug caught: the merge builds a rest copy or an entries array again, or copies the frozen edges of a defined
    // style on every resolve.
    const defined = alloc(resolveDefined);
    const inline = alloc(resolveInline) - alloc(buildInline);

    await annotate(`defined: ${defined} B; inline, its build taken out: ${inline} B`);
    expect(defined).toBeLessThanOrEqual(BUDGET.resolveDefined);
    expect(inline).toBeLessThanOrEqual(BUDGET.resolveInline);
  });
});
