import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, undrawnFrame } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the system `assets.leave` with `releaseUndrawnS` set (F198). It runs every frame of phase `sync`; the frame
// between two checks and the once-a-second pass with nothing to release both keep nothing (a release emits an event
// object, which is allowed and not measured here).
// ---------------------------------------------------------------------------

describe("the undrawn release, heap bytes per call", () => {
  // Bug: the per-frame early return builds something (a closure, a list, a boxed clock) every frame of every game.
  it("a frame between two checks: nothing", async () => {
    const bytes = bytesPerCall(await undrawnFrame(0));

    expect(bytes).toBeLessThanOrEqual(BUDGET.undrawnBetweenChecks + NOISE);
  });

  // Bug: the pass walks the records with an iterator or a callback made per pass, or builds a key list per bundle.
  it("a pass over 20 loaded bundles with nothing to release: nothing", async () => {
    const bytes = bytesPerCall(await undrawnFrame(1000.5));

    expect(bytes).toBeLessThanOrEqual(BUDGET.undrawnPassNothingToRelease + NOISE);
  });
});
