import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { describeCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: `describe()` after run() (F196). The look-ahead of `assets` calls it at least twice a rest; it rendered the
// whole graph of the game again each time.
// ---------------------------------------------------------------------------

/** Calls of a window. */
const CALLS = 10_000;

describe("describe() after run(), heap bytes per call", () => {
  // Bug: describe() after run() renders the graph again instead of answering the one it rendered.
  it("a game-sized graph, 40 windows of 12 nodes", () => {
    expect(alloc(describeCall(true), CALLS)).toBeLessThanOrEqual(1);
  });
});
