import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";
import { pooledTrip, treeSteps } from "./wrapper-pool.fixture";

// ---------------------------------------------------------------------------
// Perf: a wrapper of a parent view that leaves goes to the pool and comes back for the next parent (hot path 2в).
// ---------------------------------------------------------------------------

describe("the wrapper pool", () => {
  // Bug: the trip makes a new container, or the reset builds an array (Pixi's `removeChildren` does at every call).
  // Pixi's own `addChild` and `removeChild` allocate with the pool or without it: they are weighed alone and taken off.
  it("allocates nothing of its own a trip of a wrapper through the pool", () => {
    const { trip, wrapper } = pooledTrip();
    const first = wrapper();
    const tree = bytesPerCall(treeSteps());

    expect(bytesPerCall(trip) - tree).toBeLessThanOrEqual(BUDGET.wrapperPoolTrip + NOISE);
    expect(wrapper()).toBe(first);
    expect(wrapper()?.children).toEqual([]);
  });
});
