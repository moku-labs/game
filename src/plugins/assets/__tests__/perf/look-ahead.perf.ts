import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, restLookAhead } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the look-ahead of one rest (F194). The `flow:rest` hook walks the neighbourhood at every rest; A Memory
// Missing's ward rests many times a second while windows open and close, and every walk asked each scene of the
// neighbourhood for its bundles again and scanned the whole manifest for each node it visited.
// ---------------------------------------------------------------------------

describe("the look-ahead of a rest, heap bytes per call", () => {
  // Bug: a rest at the same place with the same committed state walks the graph again, asks every scene's `bundles`
  // again, or scans the manifest per node (F194, F196).
  it("a hub with six windows and the same committed state", async () => {
    const bytes = bytesPerCall(await restLookAhead());

    expect(bytes).toBeLessThanOrEqual(BUDGET.restLookAhead + NOISE);
  });
});
