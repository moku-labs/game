import { describe, expect, it } from "vitest";
import type { Entity } from "../../../world/types";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, hoverBoard } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: `renderer.sync.hitTest`, asked on every pointer move (F118): the hover of a mouse and the drop lookup of a
// drag. Over a board of 540 views it allocates nothing.
// ---------------------------------------------------------------------------

/** Calls of a window: a walk of 540 views takes about 0.1 ms, so the default 100 000 would take minutes. */
const CALLS = 2000;

/** The accept function of a hover over nothing: no view takes it, so the walk visits every view. */
const none = (): boolean => false;

describe("sync hitTest", () => {
  it("allocates nothing for a miss that walks every view", async () => {
    const board = await hoverBoard();

    expect(
      bytesPerCall(() => board.mock.api.sync.hitTest(500, 20, none), CALLS)
    ).toBeLessThanOrEqual(BUDGET.hitTestMiss + NOISE);
  });

  it("allocates nothing for a drop lookup that finds the slot under an item", async () => {
    const board = await hoverBoard();
    const isTarget = (entity: Entity): boolean => entity === board.target;

    expect(board.mock.api.sync.hitTest(board.drop.x, board.drop.y, isTarget)).toBe(board.target);
    expect(
      bytesPerCall(() => board.mock.api.sync.hitTest(board.drop.x, board.drop.y, isTarget), CALLS)
    ).toBeLessThanOrEqual(BUDGET.hitTestDrop + NOISE);
  });
});
