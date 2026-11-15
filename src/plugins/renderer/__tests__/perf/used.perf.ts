import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, startSprites } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: `sync.textures.used` (F184), asked by `assets` before it picks a budget victim. A plain indexed loop over the
// table of keys the views draw: 40 keys, the drawn one last (a hit walks the whole list) or none drawn (a miss).
// ---------------------------------------------------------------------------

const misses: readonly string[] = Array.from({ length: 40 }, (_, index) => `other.key-${index}`);
const hits: readonly string[] = [...misses.slice(1), "board.cell"];

describe("textures.used", () => {
  // Bug: the lookup iterates with `for…of`, spreads the keys or builds a closure per call.
  it("allocates nothing over 40 keys, a hit", async () => {
    const { mock } = await startSprites(20);
    const { used } = mock.api.sync.textures;

    expect(used(hits)).toBe(true);
    expect(bytesPerCall(() => void used(hits))).toBeLessThanOrEqual(BUDGET.texturesUsedHit + NOISE);
  });

  it("allocates nothing over 40 keys, a miss", async () => {
    const { mock } = await startSprites(20);
    const { used } = mock.api.sync.textures;

    expect(used(misses)).toBe(false);
    expect(bytesPerCall(() => void used(misses))).toBeLessThanOrEqual(
      BUDGET.texturesUsedMiss + NOISE
    );
  });
});
