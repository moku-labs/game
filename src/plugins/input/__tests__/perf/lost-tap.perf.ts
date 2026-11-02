import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, idleCheck, takenAnswer, untappedCheck } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the dev log of a lost tap (F122) on the pointer path, in a dev build. A good tap and a check that logs
// nothing keep no bytes: a payload is built only for a line that is written.
// ---------------------------------------------------------------------------

describe("the lost-tap log, heap bytes per call in a dev build", () => {
  beforeAll(() => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("keeps nothing for a tap the gate takes", () => {
    expect(bytesPerCall(takenAnswer())).toBeLessThanOrEqual(BUDGET.takenAnswer + NOISE);
  });

  it("keeps nothing for the check of a paused frame with no press", () => {
    expect(bytesPerCall(idleCheck())).toBeLessThanOrEqual(BUDGET.idleCheck + NOISE);
  });

  it("keeps nothing for a press on a view that answers no tap", () => {
    expect(bytesPerCall(untappedCheck())).toBeLessThanOrEqual(BUDGET.untappedCheck + NOISE);
  });
});
