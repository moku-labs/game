import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { backdropFixture, backdropStep, backdropWrite, bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the backdrop filters of `effects` (change 2026-10-18-memory-render, B1) — the apply Pixi's pop calls in every
// drawn frame of a frosted panel, without inputs and with a chain from back, and the sync of a tweened backdrop.
// ---------------------------------------------------------------------------

describe("effects:backdrop, heap bytes per call", () => {
  it("the apply of a backdrop without inputs, in a drawn frame", () => {
    expect(bytesPerCall(backdropFixture().applyUnder)).toBeLessThanOrEqual(
      BUDGET.backdropApply + NOISE
    );
  });

  it("the apply of a backdrop whose chain starts from back, in a drawn frame", () => {
    expect(bytesPerCall(backdropFixture().applyFrosted)).toBeLessThanOrEqual(
      BUDGET.backdropChainApply + NOISE
    );
  });

  it("a frame step with the spread of a backdrop tweened", () => {
    const fixture = backdropFixture();
    const step = bytesPerCall(backdropStep(fixture));
    // The tween's own write of a fraction into the stored value: not the sync's bytes.
    const write = bytesPerCall(backdropWrite(fixture));

    expect(step - write).toBeLessThanOrEqual(BUDGET.backdropTween + NOISE);
  });
});
