import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, heldRangeBoard, unseenBoard } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the walks of `shown` the endless loops of a board ask for every frame (E4 of change
// 2026-10-18-render-path-garbage): the answers are kept while the tree stays as it is, and a walk reads the engine's
// records, never Pixi's boxed `alpha`, and Pixi's frozen filter lists by index, so neither a still nor a moving board
// costs anything. The loops under a resting sheet with `hold: true` (change 2026-10-20-overlay-hold) are answered from
// the range and its owner's record, with nothing made.
// ---------------------------------------------------------------------------

describe("the unseen walk", () => {
  it("allocates nothing on a still board: 20 views, two loops each, and the still pass", async () => {
    expect(bytesPerCall(await unseenBoard(), 20_000)).toBeLessThanOrEqual(
      BUDGET.unseenStill + NOISE
    );
  });

  it("allocates nothing on a moving board, where every view is walked again", async () => {
    expect(bytesPerCall(await unseenBoard(true), 20_000)).toBeLessThanOrEqual(
      BUDGET.unseenMoving + NOISE
    );
  });
});

describe("the loops under a sheet that holds them", () => {
  it("allocates nothing: 20 views under a resting dim-only sheet with hold over a sharp ward", async () => {
    expect(bytesPerCall(await heldRangeBoard(), 20_000)).toBeLessThanOrEqual(
      BUDGET.loopsHeldHold + NOISE
    );
  });
});
