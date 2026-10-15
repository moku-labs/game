/**
 * @file renderer/monitor — the per-frame path of an agent build: `openFrame` at the start of a frame and
 * `commitFrame`, the `time.measure` listener that writes one ring slot from what `time` measured and the counters
 * collected, judges the spike rule, keeps the per-second accumulators and flushes once a second. Indexed stores into
 * typed arrays allocated once: no object, no closure, no iterator per frame.
 */

import type { FrameMeasure } from "../../time/types";
import type { SystemTiming } from "../../world/types";
import type { DemandReason } from "../demand/types";
import { DEMAND_REASONS } from "../reasons";
import { usedHeapBytes } from "./long-frames";
import {
  bucketOf,
  CAUSE,
  CHANGED,
  KIND_STRIDE,
  NO_REASON,
  NO_SYSTEM,
  PHASE_STRIDE,
  SYSTEM_STRIDE,
  sequenceOf,
  spikeCauses
} from "./ring";
import { addPending, annotate, flushPerf, writeDisplay } from "./stream";
import { noteTicks } from "./ticks";
import { COUNT, MEASURE, type MonitorSinks, type PerfCtx, type PerfState } from "./types";
import { BYTES_PER_MB, cell } from "./units";

/** A flush once a second of page clock. */
const FLUSH_MS = 1000;

/** A heap drop of at least this many bytes between two commits hints at a collection. */
const GC_DROP_BYTES = 0.5 * BYTES_PER_MB;

/** Pixels per megapixel. */
const PIXELS_PER_MPX = 1_000_000;

/** The most skipped frames the 8-bit `skipped` column holds; more are written as this. */
const SKIPPED_MAX = 255;

/** A gap spike whose work stayed under this share of the budget may be a collection: the `gc?` hint. */
const GC_WORK_SHARE = 0.5;

/** A gap longer than this, the agent's work left out, is no collection: the `gc?` hint needs a shorter one. */
const GC_GAP_MS = 500;

/** A gap over this many ms after a gap over it too, with little work, is a throttled page: its gap is not judged. */
const AWAY_GAP_MS = 500;

/**
 * Opens a frame: the counters and the filter kinds of the frame start at 0 and the passes from
 * now on are counted. An indexed `fill`: no allocation.
 *
 * @param sinks - The sinks.
 */
export function openFrame(sinks: MonitorSinks): void {
  sinks.counts.fill(0);
  sinks.kindApplies.fill(0);
  sinks.kindPixels.fill(0);
  sinks.inFrame = true;
}

/**
 * Writes the counters of the frame into its slot: what this backend does not measure, and what no
 * producer feeds, is NaN.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 */
function writeCounters(pc: PerfCtx, slot: number): void {
  const { perf, sinks } = pc;
  const c = perf.ring.columns;
  const { counts } = sinks;
  const bits = perf.measuring;
  const counted = (bits & MEASURE.counted) !== 0;

  c.passes[slot] = (bits & MEASURE.passes) === 0 ? Number.NaN : cell(counts, COUNT.passes);
  c.stencilPasses[slot] =
    (bits & MEASURE.stencilPasses) === 0 ? Number.NaN : cell(counts, COUNT.stencilPasses);
  c.draws[slot] = (bits & MEASURE.draws) === 0 ? Number.NaN : sinks.draws.last;
  c.filterApplies[slot] = counted ? cell(counts, COUNT.filterApplies) : Number.NaN;
  c.filterMpx[slot] = counted ? cell(counts, COUNT.filterPixels) / PIXELS_PER_MPX : Number.NaN;
  c.uploads[slot] = counted ? cell(counts, COUNT.uploads) : Number.NaN;
  c.uploadMb[slot] = counted ? cell(counts, COUNT.uploadBytes) / BYTES_PER_MB : Number.NaN;
  c.compiles[slot] = (bits & MEASURE.compiles) === 0 ? Number.NaN : cell(counts, COUNT.compiles);
  // The draw decision of the frame (spec 14): its marks and the index of its reason; B8 feeds `rebuilds`.
  const decided = pc.deps.demand.frame();

  c.marks[slot] = decided.marks;
  c.reason[slot] = reasonIndex(decided.reason);
  c.rebuilds[slot] = perf.produced === 0 ? Number.NaN : cell(counts, COUNT.rebuilds);
  // The kept pictures of the frame (spec 23), read from the state: no object per frame.
  const kept = pc.ctx.state.kept;

  c.kept[slot] = perf.drawn ? kept.drawnPictures : 0;
  c.retakes[slot] = kept.frameTakes;
}

/**
 * The index of a draw reason in ring order, `NO_REASON` for a name the order does not know.
 *
 * @param reason - The reason of the decision.
 * @returns Its index.
 * @example
 * ```ts
 * reasonIndex("first"); // 1
 * ```
 */
function reasonIndex(reason: DemandReason): number {
  const index = DEMAND_REASONS.indexOf(reason);

  return index === -1 ? NO_REASON : index;
}

/**
 * Puts a value into a fixed list of slots sorted from the largest down, when it is larger than
 * the smallest held: a five- or four-slot insertion, no sort, no allocation.
 *
 * @param indices - The index column.
 * @param values - The value column.
 * @param base - The first slot of the frame.
 * @param stride - Slots of the frame.
 * @param index - The index to insert.
 * @param value - Its value, above 0.
 */
function insertTop(
  indices: Uint8Array | Uint16Array,
  values: Float32Array,
  base: number,
  stride: number,
  index: number,
  value: number
): void {
  let place = stride;

  while (place > 0 && value > cell(values, base + place - 1)) place -= 1;

  if (place === stride) return;

  for (let move = stride - 1; move > place; move -= 1) {
    indices[base + move] = cell(indices, base + move - 1);
    values[base + move] = cell(values, base + move - 1);
  }

  indices[base + place] = index;
  values[base + place] = value;
}

/**
 * Writes the five slowest world systems of the frame, by registration index; a frame without a
 * timing table marks its first slot NaN, so its record says `systems: null`.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 * @param timing - The world's timing table, or `undefined` without one.
 */
function writeSystems(pc: PerfCtx, slot: number, timing: Readonly<SystemTiming> | undefined): void {
  const { ring } = pc.perf;
  const c = ring.columns;
  const base = slot * SYSTEM_STRIDE;

  c.sysIdx.fill(NO_SYSTEM, base, base + SYSTEM_STRIDE);
  c.sysMs.fill(0, base, base + SYSTEM_STRIDE);

  if (timing === undefined) {
    c.sysMs[base] = Number.NaN;

    return;
  }

  ring.systemNames = timing.names;

  const count = Math.min(timing.names.length, timing.ms.length);

  for (let index = 0; index < count; index += 1) {
    const ms = cell(timing.ms, index);

    if (ms > 0) insertTop(c.sysIdx, c.sysMs, base, SYSTEM_STRIDE, index, ms);
  }
}

/**
 * Writes the four filter kinds of the frame with the most pixels: the kind's index plus one (0 is
 * empty), its applies and its megapixels.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 */
function writeKinds(pc: PerfCtx, slot: number): void {
  const { sinks } = pc;
  const c = pc.perf.ring.columns;
  const base = slot * KIND_STRIDE;

  c.fltKind.fill(0, base, base + KIND_STRIDE);
  c.fltMpx.fill(0, base, base + KIND_STRIDE);
  c.fltApplies.fill(0, base, base + KIND_STRIDE);

  const kinds = sinks.kindPixels.length;

  for (let kind = 0; kind < kinds; kind += 1) {
    const pixels = cell(sinks.kindPixels, kind);

    if (pixels > 0) {
      insertTop(c.fltKind, c.fltMpx, base, KIND_STRIDE, kind + 1, pixels / PIXELS_PER_MPX);
    }
  }

  for (let place = 0; place < KIND_STRIDE; place += 1) {
    const kind = cell(c.fltKind, base + place);

    if (kind !== 0) c.fltApplies[base + place] = cell(sinks.kindApplies, kind - 1);
  }
}

/**
 * Adds the frame to the per-second accumulators: its gap to the histogram, its systems to their
 * sums and maxima, the listeners' cost to the monitor's.
 *
 * @param perf - The perf state.
 * @param measure - What `time` measured of the frame.
 * @param timing - The world's timing table, or `undefined`.
 */
function accumulate(
  perf: PerfState,
  measure: Readonly<FrameMeasure>,
  timing: Readonly<SystemTiming> | undefined
): void {
  if (!Number.isNaN(measure.gapMs)) {
    const bucket = bucketOf(measure.gapMs);

    perf.gapHist[bucket] = cell(perf.gapHist, bucket) + 1;
  }

  perf.listenersSum += measure.listenersMs;

  if (timing === undefined) return;

  const count = Math.min(timing.names.length, timing.ms.length, perf.secSum.length);

  for (let index = 0; index < count; index += 1) {
    const ms = cell(timing.ms, index);

    perf.secSum[index] = cell(perf.secSum, index) + ms;

    if (ms > cell(perf.secMax, index)) perf.secMax[index] = ms;
  }
}

/**
 * Tells whether the screen turned since the last `display` event: the canvas read now, no object.
 *
 * @param pc - The perf context.
 * @returns True when its orientation differs from the last one written.
 */
function turned(pc: PerfCtx): boolean {
  const { display } = pc.perf;
  const canvas = pc.deps.host.canvas();

  if (display === undefined || canvas === undefined) return false;

  return (canvas.width > canvas.height ? "landscape" : "portrait") !== display.orientation;
}

/**
 * Stages the budget of the frame in `perf.staged[0]`: one frame of the rate the loop can reach, the rate's or the
 * display's when that is longer (a loop runs no faster than its panel), the display from the ticks while `time` does
 * not know it (NaN compares false); a fixed `budgetMs` instead of both. Staged in the column, not chosen with `?:` and
 * not returned: a choice between a double of the record and the tagged budget, or a double handed back from a call,
 * would box the double every frame.
 *
 * @param perf - The perf state.
 * @param measure - What `time` measured of the frame.
 */
function stageBudget(perf: PerfState, measure: Readonly<FrameMeasure>): void {
  perf.staged[0] = measure.rateMs;

  if (measure.displayMs > measure.rateMs) perf.staged[0] = measure.displayMs;
  else if (Number.isNaN(measure.displayMs) && cell(perf.ticks.periodMs, 0) > measure.rateMs) {
    perf.staged[0] = cell(perf.ticks.periodMs, 0);
  }
  if (perf.budget !== "rate") perf.staged[0] = perf.budget;
}

/**
 * Tells whether `time` learned another display rate since the last `display` event. The rate's snapshot is compared by
 * reference: while it stays the same object, a frame reads nothing else.
 *
 * @param pc - The perf context.
 * @returns True when the snapshot's `displayHz` differs from the one last written.
 */
function retuned(pc: PerfCtx): boolean {
  const { perf } = pc;
  const rate = pc.ctx.deps.time.rate();

  if (rate === perf.rate) return false;

  perf.rate = rate;

  return perf.display !== undefined && rate.displayHz !== perf.display.hz;
}

/**
 * Tells whether the page is hidden: a hidden page's frames come when the browser lets them, their gaps say nothing.
 *
 * @returns True on a hidden page.
 */
function pageHidden(): boolean {
  return typeof globalThis.document !== "undefined" && globalThis.document.hidden;
}

/**
 * Tells whether the gap of a frame is judged at all: not on a hidden page, not on a throttled one (this gap and the
 * previous one over 500 ms, with little work), and not between two frames that drew nothing (the ticks of a still
 * screen). Reads the previous frame's columns: no allocation.
 *
 * @param pc - The perf context.
 * @param measure - What `time` measured of the frame.
 * @param previous - The ring slot of the previous frame; -1 for none.
 * @param littleWork - The frame's work, the agent's left out, stayed under half its budget.
 * @returns True when the gap rule applies.
 */
function gapJudged(
  pc: PerfCtx,
  measure: Readonly<FrameMeasure>,
  previous: number,
  littleWork: boolean
): boolean {
  if (pageHidden()) return false;
  if (previous === -1) return true;

  const c = pc.perf.ring.columns;
  const throttled =
    littleWork && measure.gapMs > AWAY_GAP_MS && cell(c.gapMs, previous) > AWAY_GAP_MS;

  return !throttled && (pc.perf.drawn || cell(c.drawn, previous) === 1);
}

/**
 * Writes what `time` measured of the frame into its slot: the clock numbers, the phases, the work, the flags of the
 * frame, and the budget staged in `perf.staged[0]`, read from the column so no double is handed over.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 * @param measure - What `time` measured of the frame.
 */
function writeMeasure(pc: PerfCtx, slot: number, measure: Readonly<FrameMeasure>): void {
  const { perf } = pc;
  const c = perf.ring.columns;
  const phase = slot * PHASE_STRIDE;

  c.frame[slot] = measure.frame;
  c.t[slot] = measure.at;
  c.gapMs[slot] = measure.gapMs;
  c.capMs[slot] = measure.capMs;
  c.skipped[slot] = Math.min(SKIPPED_MAX, measure.skipped);
  c.startMs[slot] = measure.startMs;
  c.rateMs[slot] = measure.rateMs;
  c.budgetMs[slot] = cell(perf.staged, 0);

  for (let index = 0; index < PHASE_STRIDE; index += 1) {
    c.phaseMs[phase + index] = cell(measure.phaseMs, index);
  }

  c.agentMs[slot] = perf.agentMs;
  c.workMs[slot] = measure.workMs;
  c.drawn[slot] = perf.drawn ? 1 : 0;
  c.idle[slot] = measure.idle ? 1 : 0;
  c.stepped[slot] = measure.stepped ? 1 : 0;
  c.gpuMs[slot] = Number.NaN;
  c.path[slot] = perf.pathId;
  c.changed[slot] = perf.flags;
}

/**
 * The `time.measure` listener of the monitor: writes the frame into the next slot of the ring,
 * then the spike rule, the GPU timer's frame, the display's ticks, the flush that is due, the accumulators, a
 * `display` event after a resize, a restore, a turn or a new display rate, and closes the frame.
 *
 * @param pc - The perf context.
 * @param measure - What `time` measured of the frame; rewritten every frame, so only its numbers are kept.
 */
export function commitFrame(pc: PerfCtx, measure: Readonly<FrameMeasure>): void {
  const { perf, sinks } = pc;
  const { ring } = perf;
  const c = ring.columns;
  // Frame k always lives in slot k % capacity (spec 11), also after a stop and start: the commit
  // number keeps counting while the ring is emptied.
  const slot = ring.written % ring.capacity;
  // The frame before it, for the gap rule; the ring holds 64 frames at least, so it is never this slot.
  const previous = ring.size === 0 ? -1 : ring.newest;

  stageBudget(perf, measure);

  const budget = cell(perf.staged, 0);
  const { agentMs } = perf;
  const timing = pc.ctx.deps.world.systemTimes();

  // The record of the frame: what `time` measured, the counters, the slowest systems, the filter kinds.
  writeMeasure(pc, slot, measure);
  writeCounters(pc, slot);
  writeSystems(pc, slot, timing);
  writeKinds(pc, slot);

  // The spike rule; a gap that says nothing (a hidden or throttled page, a still screen) is not judged. The `gc?` hint
  // of a gap spike with little work and a gap of half a second at most: the heap dropped by half a megabyte or more
  // since the previous commit (Chromium only; a hint, never a certainty). Written here, not in a
  // function: a computed double handed to a call is boxed, and this runs every frame.
  const heap = usedHeapBytes();
  const heapDrop = perf.lastHeap - heap;
  let causes = spikeCauses(measure, agentMs, budget, cell(c.capMs, previous));
  const littleWork = measure.workMs - agentMs < budget * GC_WORK_SHARE;

  if ((causes & CAUSE.gap) !== 0 && !gapJudged(pc, measure, previous, littleWork)) {
    causes &= ~CAUSE.gap;
  }

  const cameLate = (causes & CAUSE.gap) !== 0;
  const heapDropped = heapDrop >= GC_DROP_BYTES;
  const briefGap = measure.gapMs - agentMs <= GC_GAP_MS;

  if (cameLate && littleWork && heapDropped && briefGap) causes |= CAUSE["gc?"];

  // The slot becomes the newest of the ring; a spike is annotated (its causes written first: a gap spike reads them)
  // and the GPU timer gets the frame. The display's ticks learn from the frame after it was judged.
  perf.lastHeap = heap;
  ring.newest = slot;
  ring.size = Math.min(ring.size + 1, ring.capacity);
  ring.written += 1;
  c.causes[slot] = causes;
  if (causes !== 0) c.causes[slot] = causes | annotate(pc, slot);
  c.gpuPartial[slot] = 0;
  perf.timer?.commit(slot, measure.frame);
  noteTicks(perf.ticks, measure);

  // Once a second of page clock: the flush.
  if (Number.isNaN(perf.lastFlushAt)) perf.lastFlushAt = measure.at;
  else if (measure.at - perf.lastFlushAt >= FLUSH_MS) {
    perf.staged[1] = measure.at;
    flushPerf(pc);
  }

  // The per-second accumulators, the pending spike, the first drawn frame, and a `display` event after a resize, a
  // restore, a turn or a display rate `time` learned.
  accumulate(perf, measure, timing);

  if (causes !== 0) addPending(perf, sequenceOf(ring, slot));
  if (perf.drawn && Number.isNaN(perf.firstDrawnAt)) {
    perf.firstDrawnAt = measure.at + measure.workMs;
  }
  if ((perf.flags & (CHANGED.resize | CHANGED.restore)) !== 0 || turned(pc) || retuned(pc)) {
    writeDisplay(pc);
  }

  // The frame closes: the next one starts with clean flags.
  perf.flags = 0;
  perf.drawn = false;
  perf.agentMs = 0;
  perf.frame = measure.frame + 1;
  sinks.inFrame = false;
}
