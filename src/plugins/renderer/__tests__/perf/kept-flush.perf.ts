import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, keptBoard } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the flush of the kept cache in a drawn frame where none of its pictures changed (E5 of change
// 2026-10-18-render-path-garbage): 10 quiet kept views cost nothing, in a calm frame and in one where a view elsewhere
// changed and every record steps.
// ---------------------------------------------------------------------------

describe("the kept flush of a quiet board", () => {
  it("allocates nothing for 10 kept views in a calm frame", async () => {
    expect(bytesPerCall(await keptBoard(10), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptFlushQuiet + NOISE
    );
  });

  it("allocates nothing for 10 kept views stepped in a frame with a mark elsewhere", async () => {
    expect(bytesPerCall(await keptBoard(10, true), 20_000)).toBeLessThanOrEqual(
      BUDGET.keptFlushStepped + NOISE
    );
  });
});
