/* eslint-disable unicorn/no-null -- a frame record is JSON: "not measured" is `null` (spec 11 R11.1). */
/**
 * @file renderer/monitor — the frame ring: its allocation, its writes and reads, the spike rule, and `frameAt`. Every
 * write of the per-frame path here is an indexed store into a typed array allocated once.
 */

import { DEMAND_REASONS } from "../reasons";
import type {
  FrameColumns,
  FrameReadout,
  FrameReadResult,
  FrameRecord,
  FrameRing,
  PassKind,
  PassRecord,
  PerfCause,
  PerfChange,
  PerfChangeEntry
} from "./log-types";
import { PERF_GAP_BUCKETS } from "./log-types";
import type { EventRing, PerfRing, RingPasses } from "./types";
import { cell } from "./units";

/** Gaps below this many ms fall into 1 ms buckets of `frameHist`. */
const FINE_LIMIT_MS = 50;

/** Gaps from `FINE_LIMIT_MS` up to this many ms fall into buckets `COARSE_STEP_MS` wide. */
const COARSE_LIMIT_MS = 200;

/** The width of a bucket between `FINE_LIMIT_MS` and `COARSE_LIMIT_MS`, ms. */
const COARSE_STEP_MS = 5;

/** The bucket of every gap of `COARSE_LIMIT_MS` and over: the last of `PERF_GAP_BUCKETS`. */
const LAST_BUCKET = PERF_GAP_BUCKETS - 1;

/** A frame whose gap is over this many budgets (or caps) came late: a `gap` spike. */
const LATE_FACTOR = 1.5;

/** Values of `phaseMs` per frame: the six phases. */
export const PHASE_STRIDE = 6;

/** Values of `sysIdx` and `sysMs` per frame: the five slowest systems. */
export const SYSTEM_STRIDE = 5;

/** Values of `fltKind`, `fltApplies` and `fltMpx` per frame: the four kinds with the most pixels. */
export const KIND_STRIDE = 4;

/** An empty slot of `sysIdx`. */
export const NO_SYSTEM = 0xff_ff;

/** The `reason` column of a slot written without a decision: not measured. */
export const NO_REASON = 255;

/** A WebGL pass: its stencil is not measured. */
export const NO_STENCIL = 255;

/** Render passes the ring keeps per frame of capacity. */
export const PASSES_PER_FRAME = 4;

/** Changes with a subject the event ring keeps. */
export const EVENT_SLOTS = 64;

/** The path of id 0: the ring holds 1024 paths, the rest share this one. */
export const OVERFLOW_PATH = "…";

/** The bits of a frame's `changed` column. */
export const CHANGED: Readonly<Record<PerfChange, number>> = {
  resize: 1,
  resolution: 2,
  scene: 4,
  bundle: 8,
  restore: 16
};

/** The bits of a frame's `causes` column. */
export const CAUSE: Readonly<Record<PerfCause, number>> = {
  gap: 1,
  js: 2,
  gpu: 4,
  compile: 8,
  upload: 16,
  longFrame: 32,
  "gc?": 64
};

/** The changes in bit order. */
const CHANGE_NAMES: readonly PerfChange[] = ["resize", "resolution", "scene", "bundle", "restore"];

/** The causes in bit order. */
const CAUSE_NAMES: readonly PerfCause[] = [
  "gap",
  "js",
  "gpu",
  "compile",
  "upload",
  "longFrame",
  "gc?"
];

/** The pass kinds by their index in the pass ring. */
const PASS_KINDS: readonly PassKind[] = ["canvas", "texture", "filter"];

/** Any column of the ring. */
type Column = Uint8Array | Uint16Array | Uint32Array | Float32Array | Float64Array;

/**
 * Creates the ring of the changes with a subject: 64 slots, empty.
 *
 * @returns The event ring.
 */
export function createEventRing(): EventRing {
  return {
    frames: new Uint32Array(EVENT_SLOTS),
    kinds: new Uint8Array(EVENT_SLOTS),
    whats: Array.from<string | null>({ length: EVENT_SLOTS }).fill(null),
    next: 0,
    size: 0
  };
}

/**
 * Notes the subject of a change of a frame: a scene switched to, a bundle loaded.
 *
 * @param events - The event ring.
 * @param frame - The frame the change belongs to.
 * @param change - What changed.
 * @param what - Its subject.
 */
export function noteSubject(
  events: EventRing,
  frame: number,
  change: PerfChange,
  what: string | null
): void {
  const slot = events.next;

  events.frames[slot] = frame;
  events.kinds[slot] = CHANGED[change];
  events.whats[slot] = what;
  events.next = (slot + 1) % EVENT_SLOTS;
  events.size = Math.min(events.size + 1, EVENT_SLOTS);
}

/**
 * The subject of a change of a frame, the newest one noted.
 *
 * @param events - The event ring.
 * @param frame - The frame.
 * @param bit - The `CHANGED` bit.
 * @returns The subject, or `null` when no event named one.
 */
function subjectOf(events: EventRing, frame: number, bit: number): string | null {
  for (let age = 0; age < events.size; age += 1) {
    const slot = (events.next - 1 - age + EVENT_SLOTS) % EVENT_SLOTS;

    if (cell(events.frames, slot) === frame && cell(events.kinds, slot) === bit) {
      return events.whats[slot] ?? null;
    }
  }

  return null;
}

/**
 * Allocates the columns of `capacity` frames.
 *
 * @param capacity - Frames the ring keeps.
 * @returns The columns, zeroed.
 */
function createColumns(capacity: number): FrameColumns {
  return {
    frame: new Uint32Array(capacity),
    t: new Float64Array(capacity),
    gapMs: new Float32Array(capacity),
    capMs: new Float32Array(capacity),
    skipped: new Uint8Array(capacity),
    startMs: new Float32Array(capacity),
    rateMs: new Float32Array(capacity),
    budgetMs: new Float32Array(capacity),
    phaseMs: new Float32Array(capacity * PHASE_STRIDE),
    agentMs: new Float32Array(capacity),
    workMs: new Float32Array(capacity),
    drawn: new Uint8Array(capacity),
    idle: new Uint8Array(capacity),
    stepped: new Uint8Array(capacity),
    passes: new Float32Array(capacity),
    stencilPasses: new Float32Array(capacity),
    draws: new Float32Array(capacity),
    filterApplies: new Float32Array(capacity),
    filterMpx: new Float32Array(capacity),
    uploads: new Float32Array(capacity),
    uploadMb: new Float32Array(capacity),
    compiles: new Float32Array(capacity),
    marks: new Float32Array(capacity),
    rebuilds: new Float32Array(capacity),
    gpuMs: new Float32Array(capacity),
    gpuPartial: new Uint8Array(capacity),
    path: new Uint16Array(capacity),
    changed: new Uint8Array(capacity),
    causes: new Uint8Array(capacity),
    reason: new Uint8Array(capacity),
    sysIdx: new Uint16Array(capacity * SYSTEM_STRIDE),
    sysMs: new Float32Array(capacity * SYSTEM_STRIDE),
    fltKind: new Uint8Array(capacity * KIND_STRIDE),
    fltApplies: new Uint16Array(capacity * KIND_STRIDE),
    fltMpx: new Float32Array(capacity * KIND_STRIDE),
    kept: new Float32Array(capacity).fill(Number.NaN),
    retakes: new Float32Array(capacity).fill(Number.NaN)
  };
}

/**
 * Allocates the pass ring of `capacity` passes.
 *
 * @param capacity - Passes the ring keeps.
 * @returns The pass ring, empty.
 */
function createPasses(capacity: number): RingPasses {
  return {
    capacity,
    size: 0,
    newest: -1,
    written: 0,
    frame: new Uint32Array(capacity),
    index: new Uint8Array(capacity),
    kind: new Uint8Array(capacity),
    stencil: new Uint8Array(capacity),
    width: new Uint16Array(capacity),
    height: new Uint16Array(capacity),
    gpuMs: new Float32Array(capacity),
    label: Array.from<string | null>({ length: capacity }).fill(null)
  };
}

/**
 * Copies one column of `count` frames, oldest first, into the caller's array, an indexed loop over the ring.
 *
 * @param target - The caller's array; nothing is copied without one.
 * @param source - The ring's column.
 * @param stride - Values per frame.
 * @param ring - The ring.
 * @param oldest - Slot of the oldest frame to copy.
 * @param count - Frames to copy.
 */
function copyColumn(
  target: Column | undefined,
  source: Column,
  stride: number,
  ring: PerfRing,
  oldest: number,
  count: number
): void {
  if (target === undefined) return;

  for (let index = 0; index < count; index += 1) {
    const slot = (oldest + index) % ring.capacity;

    for (let value = 0; value < stride; value += 1) {
      target[index * stride + value] = cell(source, slot * stride + value);
    }
  }
}

/**
 * Copies the frames committed after the cursor into the caller's arrays, oldest first, at most `into.length` of the
 * newest of them, each column the caller asked for. Allocates nothing: the answer is the ring's one result object.
 *
 * @param ring - The ring.
 * @param into - The caller's arrays.
 * @param since - The cursor: a `written` value read earlier.
 * @returns How many frames it copied and how many it lost.
 */
function readRing(ring: PerfRing, into: FrameReadout, since: number): Readonly<FrameReadResult> {
  const available = Math.max(0, ring.written - since);
  const count = Math.min(available, ring.size, Math.max(0, into.length));
  const { result, columns } = ring;

  result.copied = count;
  result.lost = available - count;

  if (count === 0) return result;

  const oldest = (ring.newest - count + 1 + ring.capacity) % ring.capacity;

  copyColumn(into.frame, columns.frame, 1, ring, oldest, count);
  copyColumn(into.t, columns.t, 1, ring, oldest, count);
  copyColumn(into.gapMs, columns.gapMs, 1, ring, oldest, count);
  copyColumn(into.capMs, columns.capMs, 1, ring, oldest, count);
  copyColumn(into.skipped, columns.skipped, 1, ring, oldest, count);
  copyColumn(into.startMs, columns.startMs, 1, ring, oldest, count);
  copyColumn(into.rateMs, columns.rateMs, 1, ring, oldest, count);
  copyColumn(into.budgetMs, columns.budgetMs, 1, ring, oldest, count);
  copyColumn(into.phaseMs, columns.phaseMs, PHASE_STRIDE, ring, oldest, count);
  copyColumn(into.agentMs, columns.agentMs, 1, ring, oldest, count);
  copyColumn(into.workMs, columns.workMs, 1, ring, oldest, count);
  copyColumn(into.drawn, columns.drawn, 1, ring, oldest, count);
  copyColumn(into.idle, columns.idle, 1, ring, oldest, count);
  copyColumn(into.stepped, columns.stepped, 1, ring, oldest, count);
  copyColumn(into.passes, columns.passes, 1, ring, oldest, count);
  copyColumn(into.stencilPasses, columns.stencilPasses, 1, ring, oldest, count);
  copyColumn(into.draws, columns.draws, 1, ring, oldest, count);
  copyColumn(into.filterApplies, columns.filterApplies, 1, ring, oldest, count);
  copyColumn(into.filterMpx, columns.filterMpx, 1, ring, oldest, count);
  copyColumn(into.uploads, columns.uploads, 1, ring, oldest, count);
  copyColumn(into.uploadMb, columns.uploadMb, 1, ring, oldest, count);
  copyColumn(into.compiles, columns.compiles, 1, ring, oldest, count);
  copyColumn(into.marks, columns.marks, 1, ring, oldest, count);
  copyColumn(into.rebuilds, columns.rebuilds, 1, ring, oldest, count);
  copyColumn(into.gpuMs, columns.gpuMs, 1, ring, oldest, count);
  copyColumn(into.gpuPartial, columns.gpuPartial, 1, ring, oldest, count);
  copyColumn(into.path, columns.path, 1, ring, oldest, count);
  copyColumn(into.changed, columns.changed, 1, ring, oldest, count);
  copyColumn(into.causes, columns.causes, 1, ring, oldest, count);
  copyColumn(into.reason, columns.reason, 1, ring, oldest, count);
  copyColumn(into.sysIdx, columns.sysIdx, SYSTEM_STRIDE, ring, oldest, count);
  copyColumn(into.sysMs, columns.sysMs, SYSTEM_STRIDE, ring, oldest, count);
  copyColumn(into.fltKind, columns.fltKind, KIND_STRIDE, ring, oldest, count);
  copyColumn(into.fltApplies, columns.fltApplies, KIND_STRIDE, ring, oldest, count);
  copyColumn(into.fltMpx, columns.fltMpx, KIND_STRIDE, ring, oldest, count);
  copyColumn(into.kept, columns.kept, 1, ring, oldest, count);
  copyColumn(into.retakes, columns.retakes, 1, ring, oldest, count);

  return result;
}

/**
 * Allocates the ring once, at the first attach of an agent build: the columns of `capacity` frames, four passes per
 * frame, the paths with the overflow path at id 0.
 *
 * @param capacity - `renderer.monitor.frames`; 0 for the empty ring.
 * @param events - The event ring of the monitor; a fresh one when left out.
 * @param kindNames - The interned filter kinds of the sinks; none when left out.
 * @returns The ring.
 */
export function createFrameRing(
  capacity: number,
  events: EventRing = createEventRing(),
  kindNames: readonly string[] = []
): PerfRing {
  const ring: PerfRing = {
    capacity,
    size: 0,
    newest: -1,
    written: 0,
    columns: createColumns(capacity),
    passes: createPasses(capacity * PASSES_PER_FRAME),
    paths: [OVERFLOW_PATH],
    kindNames,
    systemNames: [],
    events,
    result: { copied: 0, lost: 0 },
    read: (into, since) => readRing(ring, into, since)
  };

  return ring;
}

/**
 * The ring of a build without the agent flag: capacity 0, never written.
 */
export const EMPTY_RING: FrameRing = /*#__PURE__*/ createFrameRing(0);

/**
 * Records one render pass in the pass ring, the label by reference.
 *
 * @param passes - The pass ring.
 * @param frame - The frame number.
 * @param index - The pass's index in its frame.
 * @param kind - Its `PassKind` index: 0 canvas, 1 texture, 2 filter.
 * @param stencil - 1 with a depth-stencil attachment, 0 without, `NO_STENCIL` when not measured.
 * @param width - The target's width in pixels.
 * @param height - The target's height in pixels.
 * @param label - Its label, or `null`.
 * @returns The pass's sequence number: the pass ring's `written` before it.
 */
export function writePass(
  passes: RingPasses,
  frame: number,
  index: number,
  kind: number,
  stencil: number,
  width: number,
  height: number,
  label: string | null
): number {
  const sequence = passes.written;
  const slot = sequence % passes.capacity;

  passes.frame[slot] = frame;
  passes.index[slot] = index;
  passes.kind[slot] = kind;
  passes.stencil[slot] = stencil;
  passes.width[slot] = width;
  passes.height[slot] = height;
  passes.gpuMs[slot] = Number.NaN;
  passes.label[slot] = label;
  passes.newest = slot;
  passes.size = Math.min(passes.size + 1, passes.capacity);
  passes.written = sequence + 1;

  return sequence;
}

/**
 * The commit number of the frame in a slot: `written − 1` for the newest.
 *
 * @param ring - The ring.
 * @param slot - The slot.
 * @returns The commit number.
 */
export function sequenceOf(ring: PerfRing, slot: number): number {
  return ring.written - 1 - ((ring.newest - slot + ring.capacity) % ring.capacity);
}

/**
 * The slot of the frame of a commit number, while the ring still holds it.
 *
 * @param ring - The ring.
 * @param sequence - The commit number.
 * @returns The slot, or -1 when the frame was overwritten or never committed.
 */
export function slotOfSequence(ring: PerfRing, sequence: number): number {
  const age = ring.written - 1 - sequence;

  if (age < 0 || age >= ring.size) return -1;

  return (ring.newest - age + ring.capacity) % ring.capacity;
}

/**
 * The bucket of a frame gap in a sample's `frameHist`: 1 ms buckets up to 50 ms, 5 ms buckets up to 200 ms, then one.
 *
 * @param gapMs - The gap.
 * @returns The bucket, 0 to 80.
 * @example
 * ```ts
 * bucketOf(52); // 50
 * ```
 */
export function bucketOf(gapMs: number): number {
  if (gapMs < FINE_LIMIT_MS) return Math.max(0, Math.floor(gapMs));
  if (gapMs < COARSE_LIMIT_MS) {
    return FINE_LIMIT_MS + Math.floor((gapMs - FINE_LIMIT_MS) / COARSE_STEP_MS);
  }

  return LAST_BUCKET;
}

/**
 * The two spike rules a frame is judged by when it commits, the agent's own work left out of both: it came late by at
 * least half a budget (`gap`, against the larger of budget and cap), or its work ran over the budget (`js`). A
 * stepped frame is never a spike.
 *
 * @param frame - What `time` measured of the frame.
 * @param frame.gapMs - The gap; NaN for none.
 * @param frame.capMs - The cap the frame ran under.
 * @param frame.workMs - Its work.
 * @param frame.stepped - True for a frame of `step()`.
 * @param agentMs - The agent's work of the frame interval.
 * @param budget - The frame's budget.
 * @returns The `CAUSE` bits.
 * @example
 * ```ts
 * spikeCauses({ gapMs: 25.1, capMs: 16.7, workMs: 3, stepped: false }, 0, 16.7); // 1: gap
 * ```
 */
export function spikeCauses(
  frame: { gapMs: number; capMs: number; workMs: number; stepped: boolean },
  agentMs: number,
  budget: number
): number {
  if (frame.stepped) return 0;

  let causes = 0;

  if (frame.gapMs - agentMs > LATE_FACTOR * Math.max(budget, frame.capMs)) causes |= CAUSE.gap;
  if (frame.workMs - agentMs > budget) causes |= CAUSE.js;

  return causes;
}

/**
 * Tells whether a ring is the monitor's own: the one that knows the names its columns index.
 *
 * @param ring - A ring.
 * @returns True for a ring of `monitor.frames()`.
 */
function isPerfRing(ring: FrameRing): ring is PerfRing {
  return "events" in ring && "kindNames" in ring && "systemNames" in ring;
}

/**
 * Milliseconds or megabytes of a column as a record carries them: 2 decimals, so a `Float32Array`
 * value reads as it was written.
 *
 * @param value - The value.
 * @returns The value with 2 decimals.
 * @example
 * ```ts
 * two(8.333_333_015_441_895); // 8.33
 * ```
 */
function two(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A number of a column, or `null` for "not measured".
 *
 * @param value - The value.
 * @returns The value with 2 decimals, or `null` for NaN.
 * @example
 * ```ts
 * measured(Number.NaN); // null
 * ```
 */
function measured(value: number): number | null {
  return Number.isNaN(value) ? null : two(value);
}

/**
 * The names of the bits that are set.
 *
 * @param bits - The bits.
 * @param names - The names in bit order.
 * @returns The names of the set bits, in bit order.
 */
function namesOf<Name>(bits: number, names: readonly Name[]): Name[] {
  return names.filter((_name, index) => (bits & (1 << index)) !== 0);
}

/**
 * The filter kinds of a frame from its four slots.
 *
 * @param ring - The ring.
 * @param slot - The slot.
 * @returns Kind, applies and megapixels, the most pixels first.
 */
export function filterKindsAt(
  ring: FrameRing,
  slot: number
): { kind: string; applies: number; mpx: number }[] {
  const names = isPerfRing(ring) ? ring.kindNames : [];
  const { columns } = ring;
  const kinds: { kind: string; applies: number; mpx: number }[] = [];

  for (let place = 0; place < KIND_STRIDE; place += 1) {
    const at = slot * KIND_STRIDE + place;
    const kind = cell(columns.fltKind, at);

    if (kind === 0) continue;

    kinds.push({
      kind: names[kind - 1] ?? "other",
      applies: cell(columns.fltApplies, at),
      mpx: two(cell(columns.fltMpx, at))
    });
  }

  return kinds;
}

/**
 * The slowest systems of a frame from its five slots; `null` when the frame had no timing table.
 *
 * @param ring - The ring.
 * @param slot - The slot.
 * @returns Name and ms, the slowest first, or `null`.
 */
export function systemsAt(ring: FrameRing, slot: number): { name: string; ms: number }[] | null {
  const { columns } = ring;

  if (Number.isNaN(cell(columns.sysMs, slot * SYSTEM_STRIDE))) return null;

  const names = isPerfRing(ring) ? ring.systemNames : [];
  const systems: { name: string; ms: number }[] = [];

  for (let place = 0; place < SYSTEM_STRIDE; place += 1) {
    const at = slot * SYSTEM_STRIDE + place;
    const index = cell(columns.sysIdx, at);

    if (index === NO_SYSTEM) continue;

    systems.push({ name: names[index] ?? String(index), ms: two(cell(columns.sysMs, at)) });
  }

  return systems;
}

/**
 * The changes of a frame with their subjects.
 *
 * @param ring - The ring.
 * @param slot - The slot.
 * @returns One entry per change, in bit order.
 */
function changesAt(ring: FrameRing, slot: number): PerfChangeEntry[] {
  const bits = cell(ring.columns.changed, slot);
  const frame = cell(ring.columns.frame, slot);

  return namesOf(bits, CHANGE_NAMES).map(kind => ({
    kind,
    what: isPerfRing(ring) ? subjectOf(ring.events, frame, CHANGED[kind]) : null
  }));
}

/**
 * The render passes of a frame still in the pass ring, in their order.
 *
 * @param ring - The ring.
 * @param frame - The frame number.
 * @returns The passes; empty when none was recorded or they were overwritten.
 */
export function passesOf(ring: FrameRing, frame: number): PassRecord[] {
  const { passes } = ring;
  const found: PassRecord[] = [];

  for (let age = 0; age < passes.size; age += 1) {
    const slot = (passes.newest - age + passes.capacity) % passes.capacity;
    const owner = cell(passes.frame, slot);

    if (owner < frame) break;
    if (owner !== frame) continue;

    const stencil = cell(passes.stencil, slot);

    found.unshift({
      index: cell(passes.index, slot),
      kind: PASS_KINDS[cell(passes.kind, slot)] ?? "texture",
      label: passes.label[slot] ?? null,
      stencil: stencil === NO_STENCIL ? null : stencil === 1,
      w: cell(passes.width, slot),
      h: cell(passes.height, slot),
      gpuMs: measured(cell(passes.gpuMs, slot))
    });
  }

  return found;
}

/**
 * One slot of the ring as a plain JSON-safe record: NaN as `null`, bits as names, the path id as its path.
 *
 * @param ring - The ring.
 * @param slot - The slot.
 * @returns The record.
 */
export function recordAt(ring: FrameRing, slot: number): FrameRecord {
  const c = ring.columns;
  const phase = slot * PHASE_STRIDE;
  const applies = measured(cell(c.filterApplies, slot));
  const uploads = measured(cell(c.uploads, slot));
  const kept = measured(cell(c.kept, slot));

  return {
    frame: cell(c.frame, slot),
    t: two(cell(c.t, slot)),
    gapMs: measured(cell(c.gapMs, slot)),
    capMs: two(cell(c.capMs, slot)),
    rateMs: two(cell(c.rateMs, slot)),
    budgetMs: two(cell(c.budgetMs, slot)),
    skipped: cell(c.skipped, slot),
    startMs: two(cell(c.startMs, slot)),
    phases: {
      input: two(cell(c.phaseMs, phase)),
      animate: two(cell(c.phaseMs, phase + 1)),
      layout: two(cell(c.phaseMs, phase + 2)),
      sync: two(cell(c.phaseMs, phase + 3)),
      signals: two(cell(c.phaseMs, phase + 4)),
      render: two(cell(c.phaseMs, phase + 5)),
      agent: two(cell(c.agentMs, slot))
    },
    workMs: two(cell(c.workMs, slot)),
    drawn: cell(c.drawn, slot) === 1,
    idle: cell(c.idle, slot) === 1,
    stepped: cell(c.stepped, slot) === 1,
    reason: DEMAND_REASONS[cell(c.reason, slot)] ?? null,
    passes: measured(cell(c.passes, slot)),
    stencilPasses: measured(cell(c.stencilPasses, slot)),
    draws: measured(cell(c.draws, slot)),
    filters:
      applies === null
        ? null
        : { applies, mpx: two(cell(c.filterMpx, slot)), kinds: filterKindsAt(ring, slot) },
    uploads: uploads === null ? null : { count: uploads, mb: two(cell(c.uploadMb, slot)) },
    compiles: measured(cell(c.compiles, slot)),
    marks: measured(cell(c.marks, slot)),
    rebuilds: measured(cell(c.rebuilds, slot)),
    systems: systemsAt(ring, slot),
    gpuMs: measured(cell(c.gpuMs, slot)),
    gpuPartial: cell(c.gpuPartial, slot) === 1,
    path: ring.paths[cell(c.path, slot)] ?? OVERFLOW_PATH,
    changed: changesAt(ring, slot),
    causes: namesOf(cell(c.causes, slot), CAUSE_NAMES),
    kept: kept === null ? null : { pictures: kept, retakes: cell(c.retakes, slot) }
  };
}

/**
 * One slot of the ring as a plain record, `age` 0 the newest frame; `undefined` beyond the frames held. Allocates: for
 * tests and tools, never per frame. A root export.
 *
 * @param ring - The ring of `monitor.frames()`.
 * @param age - Frames back from the newest.
 * @returns The record, or `undefined`.
 * @example
 * ```ts
 * // A test of a debug build checks the frame that a sheet opened in.
 * frameAt(app.renderer.monitor.frames(), 0)?.passes; // 3
 * frameAt(app.renderer.monitor.frames(), 5000); // undefined: the ring holds 1024
 * ```
 */
export function frameAt(ring: FrameRing, age: number): FrameRecord | undefined {
  if (!Number.isInteger(age) || age < 0 || age >= ring.size) return undefined;

  return recordAt(ring, (ring.newest - age + ring.capacity) % ring.capacity);
}
