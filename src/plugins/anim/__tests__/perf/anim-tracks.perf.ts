import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET } from "./budgets";
import { heldLoopsFixture, tracksFixture } from "./fixtures";

/** The bytes per call two windows of `alloc` may differ by: its own tolerance. */
const NOISE = 1;

/** A window ten times the default, so a stray compile weighs nothing in a step that keeps 0 B. */
const IDLE_CALLS = 100_000;

describe("anim tracks: heap bytes per frame step", () => {
  it("walks 50 loops of views nobody sees and allocates nothing", () => {
    expect(alloc(heldLoopsFixture(), IDLE_CALLS)).toBeLessThanOrEqual(
      BUDGET.animTracksHeld + NOISE
    );
  });

  it("runs 50 tracks keeping only the numbers that cross into world", () => {
    expect(alloc(tracksFixture())).toBeLessThanOrEqual(BUDGET.animTracks + NOISE);
  });
});
