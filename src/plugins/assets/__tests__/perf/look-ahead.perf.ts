import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET, NOISE } from "./budgets";
import { restLookAhead } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the look-ahead of one rest (F194). The `flow:rest` hook walks the neighbourhood at every rest; A Memory
// Missing's ward rests many times a second while windows open and close, and every walk asked each scene of the
// neighbourhood for its bundles again and scanned the whole manifest for each node it visited.
// ---------------------------------------------------------------------------

/** Calls of a window: a walk keeps a few KiB, so a window of 100 000 would collect inside it. */
const CALLS = 2000;

describe("the look-ahead of a rest, heap bytes per call", () => {
  // Bug: a rest with the same committed state asks every scene's `bundles` again, or scans the manifest per node.
  it("a hub with six windows and the same committed state", async () => {
    const bytes = alloc(await restLookAhead(), CALLS);

    expect(bytes).toBeLessThanOrEqual(BUDGET.restLookAhead + NOISE);
  });
});
