/* eslint-disable unicorn/no-null -- a row is JSON: "no number" is `null`. */
/**
 * @file What a measured arm reads from the monitor's frame ring: per frame the canvas passes, the
 * GPU and the CPU time, and their medians. Pure: the ring goes in, numbers come out. The canvas
 * passes of a frame are its passes with a `restart` reason: a non-canvas pass has 0.
 */
import { CANVAS_RESTARTS, type FrameRing } from "../../../src/index.ts";

/** The part of the frame ring an arm reads. */
export type RingView = Pick<FrameRing, "capacity" | "size" | "newest" | "written"> & {
  columns: Pick<FrameRing["columns"], "frame" | "t" | "workMs" | "gpuMs" | "gpuPartial" | "drawn">;
  passes: Pick<FrameRing["passes"], "size" | "frame" | "restart">;
};

/** One drawn frame of an arm. */
export type FrameSample = {
  /** The frame's number. */
  frame: number;
  /** When it started, page-clock ms: with the row's `origin` it is the phone's time. */
  t: number;
  /** GPU time; `null` where the timer gave none. */
  gpuMs: number | null;
  /** True when the timer lost a pass of the frame: a pass under its tick, or past its 32 slots. */
  partial: boolean;
  /** CPU time of the frame. */
  workMs: number;
  /** Canvas passes begun in it. */
  canvasPasses: number;
};

/** The medians of an arm, over its frames after the settling ones. */
export type ArmSummary = {
  frames: number;
  canvasPasses: number | null;
  gpuMs: number | null;
  /** The frames under `gpuMs` the timer lost a pass of: much of it, and the number is a floor. */
  partialFrames: number;
  workMs: number | null;
};

/** One arm, read from the ring. */
export type ArmRead = {
  frames: FrameSample[];
  /** How many canvas passes began for each reason. */
  restarts: Record<string, number>;
  summary: ArmSummary;
};

/**
 * The median of a list.
 *
 * @param values - The numbers.
 * @returns The middle, or `null` for an empty list.
 * @example
 * ```ts
 * median([4, 1, 2, 3]); // 2.5
 * ```
 */
export function median(values: readonly number[]): number | null {
  const sorted = values.toSorted((first, second) => first - second);
  const middle = sorted.length >> 1;

  if (sorted.length === 0) return null;

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Tallies the canvas passes of the pass ring, from one frame on.
 *
 * @param passes - The pass ring.
 * @param firstFrame - The first frame of the arm.
 * @returns The passes per frame and the begins per reason.
 */
function canvasPassesOf(
  passes: RingView["passes"],
  firstFrame: number
): {
  perFrame: Map<number, number>;
  restarts: Record<string, number>;
} {
  const perFrame = new Map<number, number>();
  const restarts: Record<string, number> = {};

  for (let slot = 0; slot < passes.size; slot += 1) {
    const restart = passes.restart[slot] ?? 0;
    const frame = passes.frame[slot] ?? 0;
    const name = CANVAS_RESTARTS[restart] ?? "none";

    if (restart === 0 || frame < firstFrame) continue;

    perFrame.set(frame, (perFrame.get(frame) ?? 0) + 1);
    restarts[name] = (restarts[name] ?? 0) + 1;
  }

  return { perFrame, restarts };
}

/**
 * Reads one arm: the drawn frames committed after `since`, oldest first.
 *
 * @param ring - The frame ring of the monitor.
 * @param since - The ring's `written` when the arm began.
 * @param skip - The frames the summary drops at the head: the switch itself.
 * @returns The frames, the begins per reason and the medians.
 */
export function readArm(ring: RingView, since: number, skip: number): ArmRead {
  const { columns, capacity, newest } = ring;
  const count = Math.min(ring.written - since, ring.size);
  const oldest = count > 0 ? (newest - count + 1 + capacity) % capacity : 0;
  const { perFrame, restarts } = canvasPassesOf(ring.passes, columns.frame[oldest] ?? 0);
  const frames: FrameSample[] = [];

  for (let back = count - 1; back >= 0; back -= 1) {
    const slot = (newest - back + capacity) % capacity;
    const frame = columns.frame[slot] ?? 0;
    const gpuMs = columns.gpuMs[slot] ?? Number.NaN;

    if (columns.drawn[slot] !== 1) continue;

    frames.push({
      frame,
      t: columns.t[slot] ?? 0,
      gpuMs: Number.isNaN(gpuMs) ? null : gpuMs,
      partial: columns.gpuPartial[slot] === 1,
      workMs: columns.workMs[slot] ?? 0,
      canvasPasses: perFrame.get(frame) ?? 0
    });
  }

  const settled = frames.slice(skip);

  return {
    frames,
    restarts,
    summary: {
      frames: settled.length,
      canvasPasses: median(settled.map(frame => frame.canvasPasses)),
      gpuMs: median(settled.flatMap(frame => (frame.gpuMs === null ? [] : [frame.gpuMs]))),
      partialFrames: settled.filter(frame => frame.gpuMs !== null && frame.partial).length,
      workMs: median(settled.map(frame => frame.workMs))
    }
  };
}
