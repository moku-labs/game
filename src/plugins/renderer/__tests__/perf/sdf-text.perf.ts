import { describe, expect, it } from "vitest";
import { sdfTextStage } from "../sdf-text-stage";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: a distance-field text laid out again by the renderer's pipe over the real pixi.js (A26 heap profile,
// 2026-10-18): the text gets no shader (its glyphs go to the SDF batch), so an update allocates only what Pixi lays out
// itself.
// ---------------------------------------------------------------------------

describe("an SDF text update", () => {
  it("makes no shader and allocates only Pixi's own layout", () => {
    const stage = sdfTextStage();
    let digit = 0;

    expect(
      bytesPerCall(() => {
        digit = (digit + 1) % 10;
        stage.update(digit === 0 ? "10" : String(digit));
      }, 20_000)
    ).toBeLessThanOrEqual(BUDGET.sdfTextUpdate + NOISE);
    expect(stage.made()).toBe(0);
  });
});
