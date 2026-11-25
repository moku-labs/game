import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";
import {
  frostDirtyBoard,
  frostIdleBoard,
  frostMovingBoard,
  frostSteppedBoard
} from "./frost-fixtures";

// ---------------------------------------------------------------------------
// Perf (F126 stage 5): the steady frames of eight frosted windows over a Source allocate nothing. The find is cached by
// the structure version, a mark walks its ancestors, the placement is written in place, and an idle flush reads numbers.
// ---------------------------------------------------------------------------

describe("eight frosted windows over a Source", () => {
  // Bug: a calm frame finds every window's Source again, or builds the stats of the Sources.
  it("allocates nothing in a flush with no dirty Source", async () => {
    expect(bytesPerCall(await frostIdleBoard(), 20_000)).toBeLessThanOrEqual(
      BUDGET.sourceIdle + NOISE
    );
  });

  // Bug: a step reads its window's Source through a walk of the tree, or its result's key through a string.
  it("allocates nothing when every window steps over its cached Source", async () => {
    expect(bytesPerCall(await frostSteppedBoard(), 20_000)).toBeLessThanOrEqual(
      BUDGET.sourceFind + NOISE
    );
  });

  // Bug: the walk of a mark up the parents to its Source iterates a collection.
  it("allocates nothing for a mark inside the Source, walked up to it", async () => {
    expect(bytesPerCall(await frostDirtyBoard(), 20_000)).toBeLessThanOrEqual(
      BUDGET.sourceDirty + NOISE
    );
  });

  // Bug: a sliding window writes its placement through a new array, or binds its textures again in every frame.
  it("allocates nothing for eight windows that slide every frame, their placement written in place", async () => {
    expect(bytesPerCall(await frostMovingBoard(), 20_000)).toBeLessThanOrEqual(
      BUDGET.sourceServe + NOISE
    );
  });
});
