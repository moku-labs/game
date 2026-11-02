/* eslint-disable unicorn/no-null -- a row is JSON: "no number" is `null`. */
import { describe, expect, it } from "vitest";
import { median, type RingView, readArm } from "../lib/readout";

/** A ring of four slots holding frames 11, 12 and 13, the newest in slot 2: its passes follow. */
function ring(): RingView {
  return {
    capacity: 4,
    size: 3,
    newest: 2,
    written: 13,
    columns: {
      frame: Uint32Array.from([11, 12, 13, 0]),
      t: Float64Array.from([100, 116, 132, 0]),
      workMs: Float32Array.from([2, 3, 4, 0]),
      gpuMs: Float32Array.from([5, Number.NaN, 9, 0]),
      gpuPartial: Uint8Array.from([0, 0, 0, 0]),
      drawn: Uint8Array.from([1, 1, 1, 0])
    },
    passes: {
      size: 6,
      frame: Uint32Array.from([11, 11, 11, 12, 12, 13]),
      restart: Uint8Array.from([1, 0, 2, 1, 3, 1])
    }
  };
}

describe("the median", () => {
  // Bug: the even case takes one side, and a clock bin's slope leans.
  it("takes the middle of an odd list, the mean of the two of an even one, nothing of none", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("one arm read from the ring", () => {
  // Bug: a canvas pass counted from the wrong column, or a texture pass counted as a break.
  it("counts the canvas passes of each frame by the restart column", () => {
    const arm = readArm(ring(), 10, 0);

    expect(arm.frames.map(frame => frame.canvasPasses)).toEqual([2, 2, 1]);
    expect(arm.restarts).toEqual({ first: 3, filter: 1, mask: 1 });
  });

  // Bug: a frame without its GPU number yet becomes NaN in the median.
  it("leaves a frame with no GPU time out of the GPU median, and keeps it as a frame", () => {
    const arm = readArm(ring(), 10, 0);

    expect(arm.frames[1]).toEqual({
      frame: 12,
      t: 116,
      gpuMs: null,
      partial: false,
      workMs: 3,
      canvasPasses: 2
    });
    expect(arm.summary).toEqual({
      frames: 3,
      canvasPasses: 2,
      gpuMs: 7,
      partialFrames: 0,
      workMs: 3
    });
  });

  // Bug: a frame with a pass under the timer's tick is dropped, and an arm of small passes has no GPU number.
  it("keeps a partial frame's GPU time, and counts how many there are", () => {
    const partial = ring();

    partial.columns.gpuPartial[2] = 1;

    const arm = readArm(partial, 10, 0);

    expect(arm.summary.gpuMs).toBe(7);
    expect(arm.summary.partialFrames).toBe(1);
  });

  // Bug: the frames of the arm before land in this one.
  it("reads only the frames after the cursor, and drops the settling frames from the summary", () => {
    const last = readArm(ring(), 12, 0);

    expect(last.frames.map(frame => frame.frame)).toEqual([13]);
    expect(last.restarts).toEqual({ first: 1 });
    expect(readArm(ring(), 10, 2).summary.frames).toBe(1);
  });

  // Bug: a frame the ring dropped on a skipped frame counts as a drawn frame of 0 passes.
  it("leaves out a frame that was not drawn", () => {
    const skipped = ring();

    skipped.columns.drawn[1] = 0;
    expect(readArm(skipped, 10, 0).frames.map(frame => frame.frame)).toEqual([11, 13]);
  });

  // Bug: a release page, whose ring is empty, throws instead of answering no frames.
  it("answers no frames from an empty ring", () => {
    const whole = ring();
    const empty: RingView = {
      ...whole,
      capacity: 0,
      size: 0,
      newest: -1,
      written: 0,
      passes: { ...whole.passes, size: 0 }
    };

    expect(readArm(empty, 0, 0)).toEqual({
      frames: [],
      restarts: {},
      summary: { frames: 0, canvasPasses: null, gpuMs: null, partialFrames: 0, workMs: null }
    });
  });
});
