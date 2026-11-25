import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { BUDGET } from "./budgets";
import {
  bornRestFixture,
  colourTracksFixture,
  heldLoopsFixture,
  partialTracksFixture,
  sampledStepFixture,
  sampleIdleFixture,
  tracksFixture
} from "./fixtures";

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

  it("runs 50 tracks that move some of their fields, keeping only the numbers that cross into world", () => {
    expect(alloc(partialTracksFixture())).toBeLessThanOrEqual(BUDGET.animTracksPartial + NOISE);
  });

  // Bug: the system anim.sample (F241), which runs every frame in every mode, makes an object on a frame where
  // nothing animates, or walks or copies the track table on a frame where no track was born.
  it("runs anim.sample over no track and allocates nothing", () => {
    expect(alloc(sampleIdleFixture(), IDLE_CALLS)).toBeLessThanOrEqual(
      BUDGET.animSampleIdle + NOISE
    );
  });

  it("runs anim.sample over 50 running tracks, none born, and allocates nothing", () => {
    expect(alloc(bornRestFixture(), IDLE_CALLS)).toBeLessThanOrEqual(BUDGET.animBornRest + NOISE);
  });

  // Bug: anim.sample adds bytes to a frame whose tracks run: the frame costs more than its step.
  it("adds nothing to the frame step of 50 running tracks", () => {
    expect(alloc(sampledStepFixture())).toBeLessThanOrEqual(BUDGET.animTracks + NOISE);
  });

  it("runs 50 tint tweens mixed per channel, keeping only the numbers that cross into world", () => {
    expect(alloc(colourTracksFixture())).toBeLessThanOrEqual(BUDGET.animTracksColour + NOISE);
  });
});
