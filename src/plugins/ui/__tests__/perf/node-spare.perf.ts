import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET } from "./budgets";
import { startSpareFixture } from "./node-spare.fixture";

// ---------------------------------------------------------------------------
// Change 2026-11-27-hp-2ab-style-layout. An element's enter and exit, the Yoga node only (Node 24.21, warm `alloc`).
// Before the spare every enter made a node (Yoga's wrapper object) and a 48-slot kept record, and every exit freed it.
// Now the exit puts the node and its record aside and the next enter takes them back: nothing is made. Measured over a
// control that places and removes a node that stays: placement 910 B, taken back 943 B, made new 2 174 B.
// ---------------------------------------------------------------------------

describe("the spare Yoga nodes: heap per enter and exit", () => {
  it("a node taken from the spare and put back allocates nothing over the placement it goes through", async ({
    annotate
  }) => {
    // Bug caught: the take-back or the put-aside allocates (an entry object per node, a record copied, a measure
    // function cleared through the wrapper), so a window open still allocates per element.
    const spare = await startSpareFixture();
    const control = alloc(spare.control);
    const reused = alloc(spare.reused);
    const fresh = alloc(spare.fresh);

    await annotate(
      `placement only: ${control} B; taken back: ${reused} B; made new as before the spare: ${fresh} B`
    );
    expect(reused - control).toBeLessThanOrEqual(BUDGET.spareOverPlacement);
    expect(fresh - reused).toBeGreaterThan(BUDGET.spareSaves);
  });
});
