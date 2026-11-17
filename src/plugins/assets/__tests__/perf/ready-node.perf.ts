import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, readyNodeNoAsk, readyNodeRestWithoutReady } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the step every entered node takes past the latest `ready` ask (change 2026-11-16-f204-stale-ready, F204). It
// runs on every node the graph enters, so it keeps nothing.
// ---------------------------------------------------------------------------

describe("a node entered past the ready ask, heap bytes per call", () => {
  it("while no ask waits: nothing", () => {
    expect(bytesPerCall(readyNodeNoAsk())).toBeLessThanOrEqual(BUDGET.readyNoAsk + NOISE);
  });

  it("at the first rest after a transit ask, a rest that does not list ready: nothing", () => {
    expect(bytesPerCall(readyNodeRestWithoutReady())).toBeLessThanOrEqual(
      BUDGET.readyRestWithoutReady + NOISE
    );
  });
});
