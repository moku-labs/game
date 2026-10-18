/**
 * @file renderer/monitor — the per-frame path of an agent build: `openFrame` at the start of a frame and
 * `commitFrame`, the `time.measure` listener that writes one ring slot from what `time` measured and the counters
 * collected, judges the spike rule, keeps the per-second accumulators and flushes once a second. Indexed stores into
 * typed arrays allocated once: no object, no closure, no iterator per frame. Each section of the commit (spec 11 R14)
 * runs only while it is on, and its page-clock cost goes into the second's `sectionsMs`: one clock read at each lap.
 */

import type { FrameMeasure } from "../../time/types";
import type { SystemTiming } from "../../world/types";
import type { DemandReason } from "../demand/types";
import { DEMAND_REASONS } from "../reasons";
import { pageNow } from "./clock";
import { annotateLongFrame, usedHeapBytes } from "./long-frames";
import { accumulateProblems } from "./problems";
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
import { addPending, annotateCounted, flushPerf, writeDisplay } from "./stream";
import { noteTicks } from "./ticks";
import {
  COST,
  COUNT,
  MEASURE,
  type MonitorSinks,
  type PerfCtx,
  type PerfState,
  SECTION
} from "./types";
import { BYTES_PER_MB, cellF32, cellF64, cellU8, cellU16 } from "./units";

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

/** The sections whose part of the commit runs before the spike rule, each a lap after the base's first part. */
const EARLY_SECTIONS =
  SECTION.passes | SECTION.shaders | SECTION.nodes | SECTION.memory | SECTION.gpu;

/**
 * Opens a frame: a switch of the sections applies now, so a frame is measured whole or not at all; the counters and
 * the filter kinds of the frame start at 0 and the passes from now on are counted. An indexed `fill`: no allocation.
 *
 * @param sinks - The sinks.
 */
export function openFrame(sinks: MonitorSinks): void {
  sinks.sections = sinks.sectionsNext;
  sinks.counts.fill(0);
  sinks.kindApplies.fill(0);
  sinks.kindPixels.fill(0);
  sinks.owners.applies.fill(0);
  sinks.owners.pixels.fill(0);
  sinks.inFrame = true;
}

/**
 * Writes what the counting classes saw of the frame into its slot (section `passes`): the passes and their stencil, the
 * draws, the filter applies with their pixels, the uploads, the instruction rebuilds and the render targets made and
 * dropped. What this backend does not measure, and what no producer feeds, is NaN.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 */
function writePasses(pc: PerfCtx, slot: number): void {
  const { perf, sinks } = pc;
  const c = perf.ring.columns;
  const { counts } = sinks;
  const bits = perf.measuring;
  const counted = (bits & MEASURE.counted) !== 0;

  c.passes[slot] = (bits & MEASURE.passes) === 0 ? Number.NaN : cellF64(counts, COUNT.passes);
  c.stencilPasses[slot] =
    (bits & MEASURE.stencilPasses) === 0 ? Number.NaN : cellF64(counts, COUNT.stencilPasses);
  c.draws[slot] = (bits & MEASURE.draws) === 0 ? Number.NaN : sinks.draws.last;
  c.filterApplies[slot] = counted ? cellF64(counts, COUNT.filterApplies) : Number.NaN;
  c.filterMpx[slot] = counted ? cellF64(counts, COUNT.filterPixels) / PIXELS_PER_MPX : Number.NaN;
  c.uploads[slot] = counted ? cellF64(counts, COUNT.uploads) : Number.NaN;
  c.uploadMb[slot] = counted ? cellF64(counts, COUNT.uploadBytes) / BYTES_PER_MB : Number.NaN;
  // B8 feeds `rebuilds`.
  c.rebuilds[slot] = perf.produced === 0 ? Number.NaN : cellF64(counts, COUNT.rebuilds);
  // Render targets made and dropped (U4): counted on the WebGPU texture system.
  const targets = (bits & MEASURE.targets) !== 0;

  c.targetsCreated[slot] = targets ? cellF64(counts, COUNT.targetsCreated) : Number.NaN;
  c.targetsDestroyed[slot] = targets ? cellF64(counts, COUNT.targetsDestroyed) : Number.NaN;
}

/**
 * Writes the columns of a frame whose `passes` section is off: every count of it not measured, no filter kind.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 */
function writeNoPasses(pc: PerfCtx, slot: number): void {
  const c = pc.perf.ring.columns;
  const base = slot * KIND_STRIDE;

  c.passes[slot] = Number.NaN;
  c.stencilPasses[slot] = Number.NaN;
  c.draws[slot] = Number.NaN;
  c.filterApplies[slot] = Number.NaN;
  c.filterMpx[slot] = Number.NaN;
  c.uploads[slot] = Number.NaN;
  c.uploadMb[slot] = Number.NaN;
  c.rebuilds[slot] = Number.NaN;
  c.targetsCreated[slot] = Number.NaN;
  c.targetsDestroyed[slot] = Number.NaN;
  c.fltKind.fill(0, base, base + KIND_STRIDE);
  c.fltMpx.fill(0, base, base + KIND_STRIDE);
  c.fltApplies.fill(0, base, base + KIND_STRIDE);
}

/**
 * Writes the change marks of the frame and the index of its draw reason (section `nodes`, spec 14).
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 */
function writeNodes(pc: PerfCtx, slot: number): void {
  const c = pc.perf.ring.columns;
  const decided = pc.deps.demand.frame();

  c.marks[slot] = decided.marks;
  c.reason[slot] = reasonIndex(decided.reason);
}

/**
 * Writes the kept pictures of the frame into its slot (spec 23), read from the state: no object per frame.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 */
function writeKept(pc: PerfCtx, slot: number): void {
  const c = pc.perf.ring.columns;
  const kept = pc.ctx.state.kept;

  c.kept[slot] = pc.perf.drawn ? kept.drawnPictures : 0;
  c.retakes[slot] = kept.frameTakes;
}

/**
 * Adds the page clock since the last lap of the commit to one section's cost of the second, and starts the next lap.
 * The lap's start is staged in `perf.staged[2]`: a double handed to a call would be boxed.
 *
 * @param perf - The perf state.
 * @param section - The `COST` index the time goes to.
 */
function lap(perf: PerfState, section: number): void {
  const now = pageNow();

  perf.sectionsMs[section] = cellF64(perf.sectionsMs, section) + now - cellF64(perf.staged, 2);
  perf.staged[2] = now;
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

  while (place > 0 && value > cellF32(values, base + place - 1)) place -= 1;

  if (place === stride) return;

  for (let move = stride - 1; move > place; move -= 1) {
    // Read in place, no reader: this load sees the two index kinds, a small integer, never a boxed double.
    indices[base + move] = indices[base + move - 1] ?? 0;
    values[base + move] = cellF32(values, base + move - 1);
  }

  indices[base + place] = index;
  values[base + place] = value;
}

/**
 * Writes a frame without its systems: no slot of it holds one, and the first is NaN, so its record says
 * `systems: null`.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 */
function writeNoSystems(pc: PerfCtx, slot: number): void {
  const c = pc.perf.ring.columns;
  const base = slot * SYSTEM_STRIDE;

  c.sysIdx.fill(NO_SYSTEM, base, base + SYSTEM_STRIDE);
  c.sysMs.fill(0, base, base + SYSTEM_STRIDE);
  c.sysMs[base] = Number.NaN;
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

  if (timing === undefined) {
    writeNoSystems(pc, slot);

    return;
  }

  c.sysIdx.fill(NO_SYSTEM, base, base + SYSTEM_STRIDE);
  c.sysMs.fill(0, base, base + SYSTEM_STRIDE);

  ring.systemNames = timing.names;

  const count = Math.min(timing.names.length, timing.ms.length);

  for (let index = 0; index < count; index += 1) {
    const ms = cellF64(timing.ms, index);

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
    const pixels = cellF64(sinks.kindPixels, kind);

    if (pixels > 0) {
      insertTop(c.fltKind, c.fltMpx, base, KIND_STRIDE, kind + 1, pixels / PIXELS_PER_MPX);
    }
  }

  for (let place = 0; place < KIND_STRIDE; place += 1) {
    const kind = cellU8(c.fltKind, base + place);

    if (kind !== 0) c.fltApplies[base + place] = cellF64(sinks.kindApplies, kind - 1);
  }
}

/**
 * Adds the frame to the per-second accumulators: its gap to the histogram, the listeners' cost to the monitor's.
 *
 * @param perf - The perf state.
 * @param measure - What `time` measured of the frame.
 */
function accumulate(perf: PerfState, measure: Readonly<FrameMeasure>): void {
  if (!Number.isNaN(measure.gapMs)) {
    const bucket = bucketOf(measure.gapMs);

    perf.gapHist[bucket] = cellU16(perf.gapHist, bucket) + 1;
  }

  perf.listenersSum += measure.listenersMs;
}

/**
 * Adds the frame's world systems to their per-second sums and maxima (section `systems`).
 *
 * @param perf - The perf state.
 * @param timing - The world's timing table, or `undefined`.
 */
function accumulateSystems(perf: PerfState, timing: Readonly<SystemTiming> | undefined): void {
  if (timing === undefined) return;

  const count = Math.min(timing.names.length, timing.ms.length, perf.secSum.length);

  for (let index = 0; index < count; index += 1) {
    const ms = cellF64(timing.ms, index);

    perf.secSum[index] = cellF64(perf.secSum, index) + ms;

    if (ms > cellF32(perf.secMax, index)) perf.secMax[index] = ms;
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
  const ticksSlower =
    Number.isNaN(measure.displayMs) && cellF64(perf.ticks.periodMs, 0) > measure.rateMs;

  perf.staged[0] = measure.rateMs;

  if (measure.displayMs > measure.rateMs) perf.staged[0] = measure.displayMs;
  else if (ticksSlower) {
    perf.staged[0] = cellF64(perf.ticks.periodMs, 0);
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
    littleWork && measure.gapMs > AWAY_GAP_MS && cellF32(c.gapMs, previous) > AWAY_GAP_MS;

  return !throttled && (pc.perf.drawn || cellU8(c.drawn, previous) === 1);
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
  c.budgetMs[slot] = cellF64(perf.staged, 0);

  for (let index = 0; index < PHASE_STRIDE; index += 1) {
    c.phaseMs[phase + index] = cellF32(measure.phaseMs, index);
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
 * Writes the columns of the sections that are off as not measured: the ring slot held an older frame.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 * @param sections - The `SECTION` bits on.
 */
function writeOff(pc: PerfCtx, slot: number, sections: number): void {
  const c = pc.perf.ring.columns;

  if ((sections & SECTION.passes) === 0) writeNoPasses(pc, slot);
  if ((sections & SECTION.shaders) === 0) c.compiles[slot] = Number.NaN;
  if ((sections & SECTION.nodes) === 0) {
    c.marks[slot] = Number.NaN;
    c.reason[slot] = NO_REASON;
  }
  if ((sections & SECTION.systems) === 0) writeNoSystems(pc, slot);
}

/**
 * The sections whose part of the commit runs before the spike rule, each a lap of its own after the base's first part:
 * the counting classes' numbers and the filter kinds, the compiles, the marks, the heap read, the GPU timer's frame.
 * With all five off the base goes on with no clock read. The heap read is the `gc?` hint's: the heap dropped by half a megabyte or more since the
 * previous commit (Chromium only; a hint, never a certainty); the drop is judged here, so no double leaves.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 * @param frame - The frame number, for the GPU timer.
 * @param sections - The `SECTION` bits on.
 * @returns True when the heap dropped enough for the hint.
 */
function commitEarly(pc: PerfCtx, slot: number, frame: number, sections: number): boolean {
  const { perf } = pc;
  const c = perf.ring.columns;
  let heapDropped = false;

  if ((sections & EARLY_SECTIONS) !== 0) lap(perf, COST.base);
  if ((sections & SECTION.passes) !== 0) {
    writePasses(pc, slot);
    writeKinds(pc, slot);
    lap(perf, COST.passes);
  }
  if ((sections & SECTION.shaders) !== 0) {
    c.compiles[slot] =
      (perf.measuring & MEASURE.compiles) === 0
        ? Number.NaN
        : cellF64(pc.sinks.counts, COUNT.compiles);
    lap(perf, COST.shaders);
  }
  if ((sections & SECTION.nodes) !== 0) {
    writeNodes(pc, slot);
    lap(perf, COST.nodes);
  }
  if ((sections & SECTION.memory) === 0) {
    perf.lastHeap = Number.NaN;
  } else {
    const heap = usedHeapBytes();

    heapDropped = perf.lastHeap - heap >= GC_DROP_BYTES;
    perf.lastHeap = heap;
    lap(perf, COST.memory);
  }
  if ((sections & SECTION.gpu) !== 0) {
    perf.timer?.commit(slot, frame);
    lap(perf, COST.gpu);
  }

  return heapDropped;
}

/**
 * The spike rule of a frame: its causes, a gap that says nothing (a hidden or throttled page, a still screen) left
 * out, and the `gc?` hint of a gap spike with little work and a gap of half a second at most after a heap drop. The
 * budget and the agent's time are read where they are kept, not handed over: a double handed to a call is boxed.
 *
 * @param pc - The perf context.
 * @param measure - What `time` measured of the frame.
 * @param previous - The ring slot of the previous frame; -1 for none.
 * @param heapDropped - The heap dropped enough for the hint.
 * @returns The `CAUSE` bits.
 */
function judgeFrame(
  pc: PerfCtx,
  measure: Readonly<FrameMeasure>,
  previous: number,
  heapDropped: boolean
): number {
  const { perf } = pc;
  const budget = cellF64(perf.staged, 0);
  const { agentMs } = perf;
  // No previous frame is NaN without a read: one read at slot -1 would leave `cellF32` boxing for good, every
  // `Float32Array` read of the per-frame path a heap number.
  const previousCapMs = previous === -1 ? Number.NaN : cellF32(perf.ring.columns.capMs, previous);
  let causes = spikeCauses(measure, agentMs, budget, previousCapMs);
  const littleWork = measure.workMs - agentMs < budget * GC_WORK_SHARE;

  if ((causes & CAUSE.gap) !== 0 && !gapJudged(pc, measure, previous, littleWork)) {
    causes &= ~CAUSE.gap;
  }

  const cameLate = (causes & CAUSE.gap) !== 0;
  const briefGap = measure.gapMs - agentMs <= GC_GAP_MS;

  if (cameLate && littleWork && heapDropped && briefGap) causes |= CAUSE["gc?"];

  return causes;
}

/**
 * Annotates a spike of the commit, its causes written first (a gap spike reads them): the counters' annotations, and an
 * overlapping long frame while `longFrames` is on, a lap of its own. The commit's own `annotate` of `stream.ts`, timed
 * by section; the name is the one the per-frame allocation probe (`unit/monitor-alloc.test.ts`) books to a spike.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 * @param causes - The `CAUSE` bits of the rule, not 0.
 * @param sections - The `SECTION` bits on.
 */
function annotate(pc: PerfCtx, slot: number, causes: number, sections: number): void {
  const { perf } = pc;
  const c = perf.ring.columns;

  c.causes[slot] = causes | annotateCounted(pc, slot);

  if ((sections & SECTION.longFrames) === 0) return;

  lap(perf, COST.base);
  if (annotateLongFrame(perf, slot)) c.causes[slot] = cellU8(c.causes, slot) | CAUSE.longFrame;
  lap(perf, COST.longFrames);
}

/**
 * The world systems of the frame while `systems` is on, a lap of their own: their five slowest into the slot and every
 * one into the second's sums. After the flush: the frame belongs to the new second, and the flush reads only the frames
 * before this one.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot.
 */
function commitSystems(pc: PerfCtx, slot: number): void {
  const { perf } = pc;
  const timing = pc.ctx.deps.world.systemTimes();

  lap(perf, COST.base);
  writeSystems(pc, slot, timing);
  accumulateSystems(perf, timing);
  lap(perf, COST.systems);
}

/**
 * The end of the commit: the problem rules' run of the frame while `problems` is on (a lap of its own), the pending spike, the first drawn frame, a `display`
 * event after a resize, a restore, a turn or a display rate `time` learned, and the frame closes, the next one starting
 * with clean flags. The last lap of the base.
 *
 * @param pc - The perf context.
 * @param measure - What `time` measured of the frame.
 * @param slot - The ring slot.
 * @param causes - The `CAUSE` bits of the frame.
 */
function closeCommit(
  pc: PerfCtx,
  measure: Readonly<FrameMeasure>,
  slot: number,
  causes: number
): void {
  const { perf, sinks } = pc;

  if ((sinks.sections & SECTION.problems) !== 0) {
    lap(perf, COST.base);
    accumulateProblems(pc, measure);
    lap(perf, COST.problems);
  }

  if (causes !== 0) addPending(perf, sequenceOf(perf.ring, slot));
  if (perf.drawn && Number.isNaN(perf.firstDrawnAt)) {
    perf.firstDrawnAt = measure.at + measure.workMs;
    perf.firstDrawnFrame = measure.frame;
  }
  if ((perf.flags & (CHANGED.resize | CHANGED.restore)) !== 0 || turned(pc) || retuned(pc)) {
    writeDisplay(pc);
  }

  perf.flags = 0;
  perf.drawn = false;
  perf.agentMs = 0;
  perf.frame = measure.frame + 1;
  sinks.inFrame = false;
  lap(perf, COST.base);
}

/**
 * The `time.measure` listener of the monitor: writes the frame into the next slot of the ring, then the spike rule, the
 * GPU timer's frame, the display's ticks, the flush that is due, the accumulators, a `display` event after a resize, a
 * restore, a turn or a new display rate, and closes the frame. A section that is off skips its part, whose columns
 * read as not measured; each part that runs is a lap of the page clock, summed per section for the sample.
 *
 * @param pc - The perf context.
 * @param measure - What `time` measured of the frame; rewritten every frame, so only its numbers are kept.
 */
export function commitFrame(pc: PerfCtx, measure: Readonly<FrameMeasure>): void {
  const { perf, sinks } = pc;
  const { ring } = perf;
  const sections = sinks.sections;
  // Frame k always lives in slot k % capacity (spec 11), also after a stop and start: the commit
  // number keeps counting while the ring is emptied.
  const slot = ring.written % ring.capacity;
  // The frame before it, for the gap rule; the ring holds 64 frames at least, so it is never this slot.
  const previous = ring.size === 0 ? -1 : ring.newest;

  // per frame: the first lap of the sections' cost starts here (N2).
  perf.staged[2] = pageNow();
  stageBudget(perf, measure);

  // The record of the frame: what `time` measured, the kept pictures, the sections that are off as not measured.
  writeMeasure(pc, slot, measure);
  writeKept(pc, slot);
  ring.columns.gpuPartial[slot] = 0;
  writeOff(pc, slot, sections);

  const heapDropped = commitEarly(pc, slot, measure.frame, sections);
  const causes = judgeFrame(pc, measure, previous, heapDropped);

  // The slot becomes the newest of the ring and gets its causes, a spike annotated; the display's ticks learn from the
  // frame after it was judged.
  ring.newest = slot;
  ring.size = Math.min(ring.size + 1, ring.capacity);
  ring.written += 1;
  ring.columns.causes[slot] = causes;
  if (causes !== 0) annotate(pc, slot, causes, sections);
  noteTicks(perf.ticks, measure);

  // Once a second of page clock: the flush.
  if (Number.isNaN(perf.lastFlushAt)) perf.lastFlushAt = measure.at;
  else if (measure.at - perf.lastFlushAt >= FLUSH_MS) {
    perf.staged[1] = measure.at;
    flushPerf(pc);
  }

  accumulate(perf, measure);
  if ((sections & SECTION.systems) !== 0) commitSystems(pc, slot);
  closeCommit(pc, measure, slot, causes);
}
