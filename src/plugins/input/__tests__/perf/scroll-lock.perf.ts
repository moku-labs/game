import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import {
  bytesPerCall,
  downOnMovingLocked,
  dropLocked,
  handOffLocked,
  lastFoundScroll
} from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the scroll lock (F177) on the pointer path. The refused hand-off, the catch that passes
// over a moving locked strip and the per-step drop of a press held on it keep no bytes.
// ---------------------------------------------------------------------------

describe("the scroll lock, heap bytes per call", () => {
  // Bug caught: the refused hand-off builds an object per move past the slop.
  it("keeps nothing for a move past the slop on a card in a locked strip", () => {
    const { call, ctx, pressed } = handOffLocked();

    expect(bytesPerCall(call)).toBeLessThanOrEqual(BUDGET.handOffLocked + NOISE);
    // The window measured the refusal: the card lost its press, the press is caught and no one's.
    expect(pressed.every(tag => tag === 0)).toBe(true);
    expect(ctx.state).toMatchObject({ caught: true, entity: undefined });
  });

  // Bug caught: the walk past a locked strip reads its value through a copy.
  it("keeps nothing for the catch of a down on a card in a moving locked strip", () => {
    expect(bytesPerCall(downOnMovingLocked())).toBeLessThanOrEqual(
      BUDGET.downOnMovingLocked + NOISE
    );
    expect(lastFoundScroll()).toBeUndefined();
  });

  // Bug caught: the per-step drop allocates on every frame a finger rests on a locked strip.
  it("keeps nothing for the drop of a press held on a locked strip", () => {
    const { call, ctx, pressed } = dropLocked();

    expect(bytesPerCall(call)).toBeLessThanOrEqual(BUDGET.dropLockedPress + NOISE);
    expect(pressed.every(tag => tag === 0)).toBe(true);
    expect(ctx.state).toMatchObject({ caught: true, entity: undefined });
  });
});
