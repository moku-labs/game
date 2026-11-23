/* eslint-disable unicorn/no-null -- a row is JSON: "no number" is `null`. */
/**
 * @file What a measured arm reads from the monitor's frame ring: per frame the canvas passes, the
 * GPU and the CPU time, and their medians. Pure: the ring goes in, numbers come out. The canvas
 * passes of a frame are its passes with a `restart` reason: a non-canvas pass has 0.
 */
import { CANVAS_RESTARTS, type FrameRing } from "../../../src/index.ts";

/** The part of the frame ring an arm reads. */
export type RingView = Pick<FrameRing, "capacity" | "size" | "newest" | "written"> & {
  columns: Pick<
    FrameRing["columns"],
    | "frame"
    | "t"
    | "workMs"
    | "gpuMs"
    | "gpuPartial"
    | "drawn"
    | "compiles"
    | "uploads"
    | "uploadMb"
    | "retakes"
  >;
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

/** The first draw of an arm: what its head frames paid once, before the arm settled. */
export type ArmHead = {
  /** The frames of the ring read, drawn or not. */
  frames: number;
  /** Shader programs compiled. */
  compiles: number;
  /** Textures uploaded to the GPU, and their MB. */
  uploads: number;
  uploadMb: number;
  /** Kept pictures taken. */
  retakes: number;
  /** The slowest drawn frame, CPU and GPU; `null` without a drawn frame or a GPU time. */
  worstWorkMs: number | null;
  worstGpuMs: number | null;
};

/** One arm, read from the ring. */
export type ArmRead = {
  frames: FrameSample[];
  /** How many canvas passes began for each reason. */
  restarts: Record<string, number>;
  summary: ArmSummary;
  head: ArmHead;
};

/** The frames of an arm's head: one second at 30 fps, long enough for a member's third write and its quad. */
export const HEAD_FRAMES = 30;

/**
 * A count of the ring as a number: NaN, a column not counted yet, is 0.
 *
 * @param value - The cell.
 * @returns The count.
 * @example
 * ```ts
 * countOf(Number.NaN); // 0
 * ```
 */
function countOf(value: number | undefined): number {
  return value === undefined || Number.isNaN(value) ? 0 : value;
}

/**
 * Reads the head of an arm: its first frames after the cursor, oldest first.
 *
 * @param ring - The frame ring.
 * @param count - The frames of the arm in the ring.
 * @param oldest - The slot of the oldest of them.
 * @param headFrames - How many frames the head holds.
 * @returns The head.
 */
function headOf(ring: RingView, count: number, oldest: number, headFrames: number): ArmHead {
  const { columns, capacity } = ring;
  const head: ArmHead = {
    frames: Math.min(count, headFrames),
    compiles: 0,
    uploads: 0,
    uploadMb: 0,
    retakes: 0,
    worstWorkMs: null,
    worstGpuMs: null
  };

  for (let index = 0; index < head.frames; index += 1) {
    const slot = (oldest + index) % capacity;
    const gpuMs = columns.gpuMs[slot] ?? Number.NaN;

    head.compiles += countOf(columns.compiles[slot]);
    head.uploads += countOf(columns.uploads[slot]);
    head.uploadMb += countOf(columns.uploadMb[slot]);
    head.retakes += countOf(columns.retakes[slot]);
    if (columns.drawn[slot] !== 1) continue;
    head.worstWorkMs = Math.max(head.worstWorkMs ?? 0, columns.workMs[slot] ?? 0);
    if (!Number.isNaN(gpuMs)) head.worstGpuMs = Math.max(head.worstGpuMs ?? 0, gpuMs);
  }

  return head;
}

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
 * @param headFrames - The frames the head reads: the first draw of the arm.
 * @returns The frames, the begins per reason, the medians and the head.
 */
export function readArm(
  ring: RingView,
  since: number,
  skip: number,
  headFrames = HEAD_FRAMES
): ArmRead {
  const { columns, capacity, newest } = ring;

  // How many frames of the ring belong to the arm, and where the oldest of them sits.
  const count = Math.min(ring.written - since, ring.size);
  const oldest = count > 0 ? (newest - count + 1 + capacity) % capacity : 0;
  const { perFrame, restarts } = canvasPassesOf(ring.passes, columns.frame[oldest] ?? 0);
  const frames: FrameSample[] = [];

  // The drawn frames, oldest first.
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

  // The medians leave out the head of the arm: the switch, and the GPU timer catching up.
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
    },
    head: headOf(ring, count, oldest, headFrames)
  };
}
