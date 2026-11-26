import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import type { EdgeClock } from "./edge-fixtures";

// ---------------------------------------------------------------------------
// Perf: the edge timer of an agent build (hot-path item 8) adds no heap byte to `commitEdge`. The untimed edge
// allocates its journal entry and its `flow:edge` payload; the timed one must allocate exactly that, no more: a clock
// read kept in a field or passed as an argument would box a double on every edge. A page runs one of the two for its
// whole life, so each is measured on its own instance of the runner modules: one `commitEdge` warmed with both would
// measure V8's polymorphic code, not the timer.
// ---------------------------------------------------------------------------

/** Calls of a window. */
const CALLS = 10_000;

/** Bytes per call two measurements of the same work may differ by. */
const NOISE = 1;

/**
 * Builds the edge on a fresh instance of the runner modules, so its `commitEdge` has seen no other kind of edge.
 *
 * @param clock - Which page clock times it.
 * @returns The call that takes the edge once.
 */
async function freshEdge(clock: EdgeClock): Promise<() => void> {
  vi.resetModules();

  const { edgeCall } = await import("./edge-fixtures");

  return edgeCall(clock);
}

beforeAll(() => {
  vi.stubGlobal("__MOKU_GAME_AGENT__", true);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("commitEdge, heap bytes the timer adds per edge", () => {
  // Bug: a page-clock read is stored on an object or passed to a call, so each edge boxes a number.
  it("adds nothing to the untimed edge", async () => {
    const timed = alloc(await freshEdge("stub"), CALLS);
    const untimed = alloc(await freshEdge("untimed"), CALLS);

    expect(timed - untimed).toBeLessThanOrEqual(NOISE);
  });
});
