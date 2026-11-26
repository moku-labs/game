import { describe, expect, it } from "vitest";
import { allocCold } from "../../../../../tests/perf/alloc";
import { restMoveFixture } from "./fixtures";

// ---------------------------------------------------------------------------
// Change 2026-11-26-f244-peek-pool, slice 1, cold tier: the rest move of 0 ms of `rest-track.perf.ts`, measured while
// V8 runs it unoptimized, as a phone runs engine code in its first seconds. What an optimized call erases (an
// iterator, a short array, a boxed number) shows here; a start that built its track again would show as kilobytes.
// ---------------------------------------------------------------------------

/** Bytes a move keeps outside the optimizing tiers, through `startTrack` alone: measured 3 120 B on Node 24.21, and a margin. */
const COLD_MOVE_BYTES = 3300;

describe("anim: a rest move of 0 ms, start to end, heap bytes, cold", () => {
  it("starts and ends a rest track from a kept record outside the optimizing tiers", async ({
    annotate
  }) => {
    // Bug caught: an iterator, a key array or a record made again per start in unoptimized code.
    const bytes = allocCold(restMoveFixture(false));

    await annotate(`a rest move, cold: ${bytes} B`);
    expect(bytes).toBeLessThanOrEqual(COLD_MOVE_BYTES);
  });
});
