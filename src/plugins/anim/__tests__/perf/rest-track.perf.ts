import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { restMoveFixture } from "./fixtures";

// ---------------------------------------------------------------------------
// Change 2026-11-26-f244-peek-pool, slice 1: a rest move of 0 ms of one element, start to end, as a turn of a page
// moves it. Before the change every start built its track (keys, names, nine typed arrays over a buffer, a masked set,
// a patch) and a handle of four closures. The records of dropped tracks are kept for the next start and the bases and
// owners stay in their tables, so the track table makes nothing of its own. What is left is the world's: the
// `Animation` count added and removed through two ECS commands with the copy of its value the store keeps, and the
// table of running tracks, whose ids are new at every start (V8's ordered hash tables do not reuse a deleted slot, so
// they grow a new table now and then). Measured on Node 24.21, warm, over the mock world: 712 to 760 B a move.
// ---------------------------------------------------------------------------

/** Bytes a move keeps through `startTrack` alone: the measured 712 to 760 B and a margin. */
const MOVE_BYTES = 800;

/**
 * Bytes the handle adds to a move through the `TweenDriver` seam: one object of three fields and no closure, which a
 * hook may keep (`HANDLE_BYTES` of `ui/__tests__/perf/album.perf.ts`). Measured 48 B: the object and the slack V8 leaves in a new instance of a class.
 */
const HANDLE_BYTES = 48;

/** The bytes per call two windows of `alloc` may differ by: its own tolerance. */
const NOISE = 1;

describe("anim: a rest move of 0 ms, start to end, heap bytes", () => {
  it("starts and ends a rest track from a kept record, keeping only the world's bookkeeping", async ({
    annotate
  }) => {
    // Bug caught: a start that builds its track, its keys, its cells or its patch again.
    const bytes = alloc(restMoveFixture(false));

    await annotate(`a rest move through startTrack: ${bytes} B`);
    expect(bytes).toBeLessThanOrEqual(MOVE_BYTES + NOISE);
  });

  it("adds one small handle when the move goes through the driver", async ({ annotate }) => {
    // Bug caught: a handle of closures, or a handle that allocates more than its three fields.
    const plain = alloc(restMoveFixture(false));
    const handled = alloc(restMoveFixture(true));

    await annotate(`the handle of a rest move: ${handled - plain} B`);
    expect(handled - plain).toBeLessThanOrEqual(HANDLE_BYTES + 2 * NOISE);
  });
});
