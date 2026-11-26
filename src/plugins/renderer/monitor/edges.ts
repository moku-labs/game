/* eslint-disable unicorn/no-null -- the log is JSON: "not measured" is `null`, never 0 (spec 11 R11.1). */
/**
 * @file renderer/monitor — the flow edges of an agent build (change 2026-11-26-hp-8-flow-timer). The commit of a frame
 * takes the edges `flow.edgeTimes()` timed since the previous commit: they were taken before the frame started or
 * inside it, so they are counted in it. One compare when none came; otherwise indexed reads of the flow's ring and
 * indexed stores into the frame's four columns and the second's sums, the frame of each edge kept by its slot: no
 * object, no closure. The flush reads the flow's ring again for the `edge` lines, `sample.edges` and a spike's edges,
 * built only there.
 */
import type { EdgeTiming } from "../../flow/types";
import type { PerfEdgeEntry, PerfSampleLine } from "./log-types";
import { internPath, OVERFLOW_PATH } from "./ring";
import type { PerfCtx, PerfState } from "./types";
import { cellF64, roundTo } from "./units";

/** The most edges the 16-bit `edges` column holds; more are written as this. */
const EDGES_MAX = 0xff_ff;

/** The slots of `PerfState.edgeSec`. */
const SEC_COUNT = 0;
const SEC_MS = 1;
const SEC_BODY = 2;
const SEC_MAX = 3;
const SEC_PATH = 4;

/**
 * Takes the edges of `[edgeSeen, written)` the flow's ring still holds into the frame: their count, their ms summed, the
 * costliest and its node's path into the slot, the same into the second's sums, the frame into each edge's slot of
 * `edgeFrame`. An edge the ring overwrote before this commit is left out; the flush counts it lost.
 *
 * @param perf - The perf state.
 * @param timing - The flow's ring.
 * @param slot - The ring slot of the frame.
 * @param frame - The frame number.
 */
function takeEdges(
  perf: PerfState,
  timing: Readonly<EdgeTiming>,
  slot: number,
  frame: number
): void {
  const c = perf.ring.columns;
  const sec = perf.edgeSec;
  const to = timing.written;
  const from = Math.max(perf.edgeSeen, to - timing.capacity);
  let sum = 0;
  let body = 0;
  let max = -1;
  let maxAt = 0;

  for (let index = from; index < to; index += 1) {
    const at = index % timing.capacity;
    const ms = cellF64(timing.ms, at);
    const bodyMs = cellF64(timing.bodyMs, at);

    sum += ms;
    if (!Number.isNaN(bodyMs)) body += bodyMs;
    if (ms > max) {
      max = ms;
      maxAt = at;
    }
    perf.edgeFrame[at] = frame;
  }

  const count = to - from;
  const path = internPath(perf, timing.node[maxAt] ?? OVERFLOW_PATH);

  perf.edgeSeen = to;
  c.edges[slot] = Math.min(count, EDGES_MAX);
  c.edgeMs[slot] = sum;
  c.edgeMaxMs[slot] = max;
  c.edgePath[slot] = path;
  sec[SEC_COUNT] = cellF64(sec, SEC_COUNT) + count;
  sec[SEC_MS] = cellF64(sec, SEC_MS) + sum;
  sec[SEC_BODY] = cellF64(sec, SEC_BODY) + body;
  if (max > cellF64(sec, SEC_MAX)) {
    sec[SEC_MAX] = max;
    sec[SEC_PATH] = path;
  }
}

/**
 * The flow edges of a frame, in every frame of an agent build: none came since the previous commit (one compare), and
 * the slot reads 0; or they go into the slot and the second's sums. Without `flow.edgeTimes()` the slot reads not
 * measured. After the flush, as the systems: the frame belongs to the new second.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot of the frame.
 * @param frame - The frame number.
 */
export function commitEdges(pc: PerfCtx, slot: number, frame: number): void {
  const { perf } = pc;
  const c = perf.ring.columns;
  const timing = pc.ctx.deps.flow.edgeTimes();

  c.edges[slot] = 0;
  c.edgePath[slot] = 0;

  if (timing === undefined) {
    c.edgeMs[slot] = Number.NaN;
    c.edgeMaxMs[slot] = Number.NaN;

    return;
  }

  c.edgeMs[slot] = 0;
  c.edgeMaxMs[slot] = 0;

  if (timing.written !== perf.edgeSeen) takeEdges(perf, timing, slot, frame);
}

/**
 * Milliseconds of an edge as the log carries them: 2 decimals.
 *
 * @param value - Milliseconds.
 * @returns The value with 2 decimals.
 * @example
 * ```ts
 * edgeMs(0.4251); // 0.43
 * ```
 */
function edgeMs(value: number): number {
  return roundTo(value, 2);
}

/**
 * Milliseconds of an edge that may not have been measured.
 *
 * @param value - Milliseconds, NaN when not measured.
 * @returns The value with 2 decimals, or `null` for NaN.
 * @example
 * ```ts
 * measuredMs(Number.NaN); // null
 * ```
 */
function measuredMs(value: number): number | null {
  return Number.isNaN(value) ? null : roundTo(value, 2);
}

/**
 * The first edge index the flush reads: the first not flushed yet that the flow's ring still holds.
 *
 * @param perf - The perf state.
 * @param timing - The flow's ring.
 * @returns The index; the flush reads up to `perf.edgeSeen`.
 */
export function firstUnflushed(perf: PerfState, timing: Readonly<EdgeTiming>): number {
  return Math.max(perf.edgeFlushed, timing.written - timing.capacity);
}

/**
 * One edge of the flow's ring as a plain entry: the frame it is counted in, its node, outcome and next path, its ms.
 *
 * @param perf - The perf state.
 * @param timing - The flow's ring.
 * @param index - The edge's index, counted since the app started.
 * @returns A fresh entry.
 */
export function edgeOf(
  perf: PerfState,
  timing: Readonly<EdgeTiming>,
  index: number
): PerfEdgeEntry {
  const at = index % timing.capacity;

  return {
    frame: cellF64(perf.edgeFrame, at),
    node: timing.node[at] ?? OVERFLOW_PATH,
    outcome: timing.outcome[at] ?? "",
    next: timing.next[at] ?? "",
    ms: edgeMs(cellF64(timing.ms, at)),
    commitMs: edgeMs(cellF64(timing.commitMs, at)),
    hooksMs: edgeMs(cellF64(timing.hooksMs, at)),
    bodyMs: measuredMs(cellF64(timing.bodyMs, at)),
    wallMs: measuredMs(cellF64(timing.wallMs, at))
  };
}

/**
 * The edges of the second for its sample: the sums the commits kept, and `lost`, the edges of `[edgeFlushed, edgeSeen)`
 * the flow's ring overwrote before this flush. Counted here only, before the flush moves `edgeFlushed` on.
 *
 * @param pc - The perf context.
 * @returns The edges of the second, or `null` without `flow.edgeTimes()`.
 */
export function edgesOfSecond(pc: PerfCtx): NonNullable<PerfSampleLine["edges"]> | null {
  const timing = pc.ctx.deps.flow.edgeTimes();

  if (timing === undefined) return null;

  const { perf } = pc;
  const sec = perf.edgeSec;
  const count = cellF64(sec, SEC_COUNT);
  const held = timing.written - timing.capacity;

  return {
    count,
    ms: edgeMs(cellF64(sec, SEC_MS)),
    bodyMs: edgeMs(cellF64(sec, SEC_BODY)),
    maxMs: edgeMs(cellF64(sec, SEC_MAX)),
    maxNode: count === 0 ? null : (perf.ring.paths[cellF64(sec, SEC_PATH)] ?? OVERFLOW_PATH),
    lost: Math.max(0, Math.min(perf.edgeSeen, held) - perf.edgeFlushed)
  };
}

/**
 * The edges counted in one frame, oldest first, those the flow's ring still holds.
 *
 * @param pc - The perf context.
 * @param frame - The frame number.
 * @returns The entries, or `null` without `flow.edgeTimes()`.
 */
export function edgesOfFrame(pc: PerfCtx, frame: number): PerfEdgeEntry[] | null {
  const timing = pc.ctx.deps.flow.edgeTimes();

  if (timing === undefined) return null;

  const { perf } = pc;
  const found: PerfEdgeEntry[] = [];

  for (
    let index = Math.max(0, timing.written - timing.capacity);
    index < perf.edgeSeen;
    index += 1
  ) {
    if (cellF64(perf.edgeFrame, index % timing.capacity) === frame) {
      found.push(edgeOf(perf, timing, index));
    }
  }

  return found;
}
