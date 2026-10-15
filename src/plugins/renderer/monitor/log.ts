/* eslint-disable unicorn/no-null -- the log is JSON: "not measured on this build or backend" is `null`, never 0 (spec 11 R11.1). */
/**
 * @file renderer/monitor — the line builders of the performance log (H3, R11): the header, the sample of a second, a
 * spike with its detail, events, marks, thermal readings and long frames. Every line is a fresh object, deep-frozen
 * before a listener gets it, built at a flush or when something happens, never per frame. Numbers are rounded here:
 * ms and MB to 2 decimals, counts whole.
 */
import type { Json } from "../../model/types";
import { nativeShell, readingOf } from "../../time/native";
import type { ThermalReading } from "../../time/types";
import { epochOf, pageNow } from "./clock";
import { compilesOf } from "./compiles";
import {
  type FrameRecord,
  PERF_LOG_VERSION,
  type PerfDisplay,
  type PerfEventLine,
  type PerfEventName,
  type PerfHeaderLine,
  type PerfLongFrameLine,
  type PerfMarkLine,
  type PerfMeasured,
  type PerfSampleLine,
  type PerfSpikeLine,
  type PerfThermalLine
} from "./log-types";
import { entryOf, heapMb, longFramesIn } from "./long-frames";
import { OVERFLOW_PATH, PHASE_STRIDE, passesOf, recordAt } from "./ring";
import { type LongFrameRecord, MEASURE, type PerfCtx, type PerfRing } from "./types";
import { BYTES_PER_MB, cell, roundTo } from "./units";

/** What follows the Android model in a user agent: `…; SM-A266B Build/…`. */
const UA_BUILD = " Build/";

/** The WebView's Chrome major in a user agent. */
const UA_CHROME = /Chrome\/(\d+)/;

/** Bytes of one KiB. */
const BYTES_PER_KB = 1024;

/**
 * Spec 10's build id of the page: `"debug-20261014T153012Z"`, `"debug-full-…"` or `"dev"`; never a version string.
 *
 * @returns The id, or `null` on a page without one.
 */
export function buildId(): string | null {
  return typeof __MOKU_GAME_BUILD__ === "string" ? __MOKU_GAME_BUILD__ : null;
}

/**
 * Freezes a line and every object and array in it, so a listener may keep it after it returns.
 *
 * @param value - The line, or a part of it.
 * @returns The same value, frozen.
 */
export function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;

  Object.freeze(value);

  for (const key of Object.keys(value)) deepFreeze(Reflect.get(value, key));

  return value;
}

/**
 * Milliseconds as the log carries them.
 *
 * @param value - Milliseconds.
 * @returns The value with 2 decimals.
 * @example
 * ```ts
 * ms(8.333_33); // 8.33
 * ```
 */
function ms(value: number): number {
  return roundTo(value, 2);
}

/**
 * Normalizes a device model like the shell's `Build.MODEL`: trimmed, inner spaces to `-`, upper case.
 *
 * @param model - The model.
 * @returns The normalized model.
 * @example
 * ```ts
 * normalizeModel(" sm a266b "); // "SM-A266B"
 * ```
 */
function normalizeModel(model: string): string {
  return model.trim().replaceAll(/\s+/g, "-").toUpperCase();
}

/**
 * The model token of an Android user agent: what stands between the last `;` and ` Build/`. A scan
 * of the string, no backtracking.
 *
 * @param userAgent - The user agent.
 * @returns The model, or `undefined` for a user agent without one.
 * @example
 * ```ts
 * uaModel("Mozilla/5.0 (Linux; Android 15; SM-A266B Build/AP3A)"); // "SM-A266B"
 * ```
 */
function uaModel(userAgent: string): string | undefined {
  const end = userAgent.indexOf(UA_BUILD);

  if (end === -1) return undefined;

  const token = userAgent.slice(userAgent.lastIndexOf(";", end) + 1, end).trim();

  return token === "" || token.includes(")") ? undefined : token;
}

/**
 * The device model: the native shell's when it gives one, otherwise the model token of an Android user agent.
 *
 * @param userAgent - The user agent.
 * @returns The model and where it came from.
 */
function modelOf(userAgent: string): { model: string | null; modelFrom: "shell" | "ua" | null } {
  const shellModel = nativeShell()?.device?.model;

  if (typeof shellModel === "string" && shellModel.trim() !== "") {
    return { model: normalizeModel(shellModel), modelFrom: "shell" };
  }

  const token = uaModel(userAgent);

  return token === undefined ? { model: null, modelFrom: null } : { model: token, modelFrom: "ua" };
}

/**
 * The screen of the moment: resolution, canvas, CSS size, safe area in CSS pixels, backend and orientation.
 *
 * @param pc - The perf context.
 * @returns A fresh display.
 */
export function displayOf(pc: PerfCtx): PerfDisplay {
  const { host, viewport } = pc.deps;
  const canvas = host.canvas();
  const resolution = host.resolution();
  const width = canvas?.width ?? 0;
  const height = canvas?.height ?? 0;
  const size = viewport.size();
  const scale = size.scale;

  return {
    dpr: pc.ctx.state.host.resolution.dpr,
    resolution,
    maxResolution: pc.ctx.config.maxResolution,
    canvas: { w: width, h: height },
    css: { w: Math.round(width / resolution), h: Math.round(height / resolution) },
    safeArea: {
      t: ms(size.safeArea.top * scale),
      r: ms(size.safeArea.right * scale),
      b: ms(size.safeArea.bottom * scale),
      l: ms(size.safeArea.left * scale)
    },
    backend: host.kind(),
    orientation: width > height ? "landscape" : "portrait"
  };
}

/**
 * What this build and backend measure, for the header.
 *
 * @param pc - The perf context.
 * @returns The measured kinds, in the order of `PerfMeasured`.
 */
function measuredOf(pc: PerfCtx): PerfMeasured[] {
  const bits = pc.perf.measuring;
  const list: PerfMeasured[] = [];

  if ((bits & MEASURE.gpu) !== 0) list.push("gpu");
  if ((bits & MEASURE.passes) !== 0) list.push("passes");
  if ((bits & MEASURE.stencilPasses) !== 0) list.push("stencilPasses");
  if ((bits & MEASURE.draws) !== 0) list.push("draws");
  if ((bits & MEASURE.counted) !== 0) list.push("filters", "uploads");
  if ((bits & MEASURE.compiles) !== 0) list.push("compiles");
  // The draw decision of spec 14 fills `marks` in every agent build.
  list.push("marks");
  if (pc.perf.longFrames.type !== undefined) list.push("longFrames");
  if (heapMb() !== null) list.push("heap");
  if (pc.ctx.deps.world.systemTimes() !== undefined) list.push("systems");
  // The kept pictures of spec 23 are counted in every agent build.
  list.push("kept");

  return list;
}

/**
 * The caps of the loop, from the newest non-idle and idle frames of the ring: 0 before any frame.
 *
 * @param ring - The ring.
 * @returns `maxFps`, `idleFps` and the newest frame's `rateMs`.
 */
function capsOf(ring: PerfRing): { maxFps: number; idleFps: number; rateMs: number } {
  const c = ring.columns;
  let maxFps = 0;
  let idleFps = 0;

  for (let age = 0; age < ring.size && (maxFps === 0 || idleFps === 0); age += 1) {
    const slot = (ring.newest - age + ring.capacity) % ring.capacity;
    const fps = Math.round(1000 / cell(c.capMs, slot));

    if (cell(c.idle, slot) === 1) idleFps ||= fps;
    else maxFps ||= fps;
  }

  return { maxFps, idleFps, rateMs: ring.size === 0 ? 0 : cell(c.rateMs, ring.newest) };
}

/**
 * The thermal reading of the shell at this moment, when it answers at once.
 *
 * @returns The reading, the promise of a shell that answers later, or `null` without a reader.
 */
export function shellThermal(): ThermalReading | Promise<unknown> | null {
  const answer = nativeShell()?.thermal?.read();

  if (answer === undefined) return null;

  return answer instanceof Promise ? answer : readingOf(answer);
}

/**
 * The header of a subscriber: the page, the device, the GPU, the display, the shell's thermal reading, the loop's
 * frame rate and the configuration, built from the live state.
 *
 * @param pc - The perf context.
 * @param thermal - The shell's reading, or `null`.
 * @returns A fresh header.
 */
export function headerLine(pc: PerfCtx, thermal: ThermalReading | null): PerfHeaderLine {
  const navigator = typeof globalThis.navigator === "undefined" ? undefined : globalThis.navigator;
  const userAgent = navigator?.userAgent ?? "";
  const cores = navigator?.hardwareConcurrency;
  const memory: unknown =
    navigator === undefined ? undefined : Reflect.get(navigator, "deviceMemory");
  const { host } = pc.deps;
  const adapter = host.adapter();
  const gl = host.gl();
  const caps = capsOf(pc.perf.ring);
  const { budget } = pc.perf;
  const renderer: unknown = gl === undefined ? undefined : gl.getParameter(gl.RENDERER);

  return {
    v: PERF_LOG_VERSION,
    kind: "header",
    t: epochOf(pageNow()),
    build: buildId(),
    timeOrigin: globalThis.performance.timeOrigin,
    engine: typeof __MOKU_GAME_ENGINE__ === "string" ? __MOKU_GAME_ENGINE__ : null,
    device: {
      userAgent,
      ...modelOf(userAgent),
      webview: UA_CHROME.exec(userAgent)?.[1] ?? null,
      cores: typeof cores === "number" ? cores : null,
      memoryGb: typeof memory === "number" ? memory : null
    },
    gpu: {
      backend: host.kind(),
      // An older WebView has no `adapter.info` (only `requestAdapterInfo()`): the fields are null.
      vendor: adapter?.info?.vendor ?? null,
      architecture: adapter?.info?.architecture ?? null,
      renderer: typeof renderer === "string" ? renderer : null,
      timer: pc.perf.timer?.kind ?? null
    },
    display: displayOf(pc),
    thermal,
    rate: pc.ctx.deps.time.rate(),
    config: {
      maxFps: caps.maxFps,
      idleFps: caps.idleFps,
      budgetMs: ms(budget === "rate" ? caps.rateMs : budget),
      budget,
      frames: pc.perf.ring.capacity
    },
    measured: measuredOf(pc)
  };
}

/**
 * The mean and maximum of a sum and a peak.
 *
 * @param sum - The sum.
 * @param count - Its count.
 * @param max - The peak.
 * @returns `{ mean, max }`, 0 for no count.
 */
function meanMax(sum: number, count: number, max: number): { mean: number; max: number } {
  return { mean: count === 0 ? 0 : ms(sum / count), max: ms(max) };
}

/**
 * The value at a quantile of the first `count` values of a sorted array: nearest rank.
 *
 * @param sorted - The sorted values.
 * @param count - How many there are.
 * @param quantile - 0.5, 0.9, 0.99.
 * @returns The value, 0 for none.
 */
function rank(sorted: Float32Array, count: number, quantile: number): number {
  if (count === 0) return 0;

  return ms(cell(sorted, Math.min(count - 1, Math.max(0, Math.ceil(quantile * count) - 1))));
}

/**
 * The slots of a window of the ring, newest first: the frames whose start lies in `[start, end)`.
 *
 * @param ring - The ring.
 * @param start - The window's start, page clock.
 * @param end - Its end.
 * @returns The first age in the window and how many frames it holds.
 */
export function windowOf(
  ring: PerfRing,
  start: number,
  end: number
): { first: number; count: number } {
  const c = ring.columns;
  let first = 0;

  while (first < ring.size && cell(c.t, slotAt(ring, first)) >= end) first += 1;

  let count = 0;

  while (first + count < ring.size && cell(c.t, slotAt(ring, first + count)) >= start) count += 1;

  return { first, count };
}

/**
 * The slot of a frame `age` frames before the newest.
 *
 * @param ring - The ring.
 * @param age - Frames back.
 * @returns The slot.
 */
export function slotAt(ring: PerfRing, age: number): number {
  return (ring.newest - age + ring.capacity) % ring.capacity;
}

/**
 * Sorts the values a window gives into the scratch array and answers its spread.
 *
 * @param pc - The perf context.
 * @param window - The window.
 * @param window.first - Its first age.
 * @param window.count - Its frames.
 * @param read - Reads a frame's value; NaN leaves the frame out.
 * @returns The values kept, and the scratch view sorted over them.
 */
function sortedOf(
  pc: PerfCtx,
  window: { first: number; count: number },
  read: (slot: number) => number
): { count: number; sorted: Float32Array } {
  const { ring, scratch } = pc.perf;
  let count = 0;

  for (let age = window.first; age < window.first + window.count; age += 1) {
    const value = read(slotAt(ring, age));

    if (!Number.isNaN(value)) {
      scratch[count] = value;
      count += 1;
    }
  }

  // eslint-disable-next-line unicorn/no-array-sort -- sorted in place over the scratch view: no copy (spec 11 R11.3).
  return { count, sorted: scratch.subarray(0, count).sort() };
}

/**
 * Sums of one window, per drawn frame where the log asks so.
 */
type Totals = {
  drawn: number;
  idle: number;
  skipped: number;
  missed: number;
  missedDrawn: number;
  overBudget: number;
  spikes: number;
  /** Sums of start, the six phases and the agent phase. */
  phaseSum: Float64Array;
  phaseMax: Float64Array;
  passes: number;
  passesMax: number;
  stencil: number;
  draws: number;
  drawsMax: number;
  applies: number;
  appliesMax: number;
  mpx: number;
  uploads: number;
  uploadMb: number;
  compiles: number;
  rebuilds: number;
  /** The most kept pictures of a drawn frame, and the takes of the window. */
  keptMax: number;
  retakes: number;
};

/**
 * Adds one phase of a frame to the sums of a window.
 *
 * @param totals - The sums.
 * @param index - 0 for start, 1 to 6 the phases, 7 the agent.
 * @param value - The phase's ms.
 */
function addPhase(totals: Totals, index: number, value: number): void {
  totals.phaseSum[index] = cell(totals.phaseSum, index) + value;
  totals.phaseMax[index] = Math.max(cell(totals.phaseMax, index), value);
}

/**
 * Adds one frame of a window: its phases, its counts, its gap.
 *
 * @param totals - The sums.
 * @param c - The ring's columns.
 * @param slot - The frame's slot.
 */
function addFrame(totals: Totals, c: PerfRing["columns"], slot: number): void {
  const agent = cell(c.agentMs, slot);
  const missed = cell(c.gapMs, slot) > 1.5 * cell(c.capMs, slot);

  addPhase(totals, 0, cell(c.startMs, slot));

  for (let index = 0; index < PHASE_STRIDE; index += 1) {
    addPhase(totals, index + 1, cell(c.phaseMs, slot * PHASE_STRIDE + index));
  }

  addPhase(totals, PHASE_STRIDE + 1, agent);
  totals.idle += cell(c.idle, slot);
  totals.overBudget += cell(c.workMs, slot) - agent > cell(c.budgetMs, slot) ? 1 : 0;
  totals.spikes += cell(c.causes, slot) === 0 ? 0 : 1;
  totals.missed += missed ? 1 : 0;
  totals.missedDrawn += missed && cell(c.drawn, slot) === 1 ? 1 : 0;
  totals.skipped += cell(c.skipped, slot);
  totals.uploads += cell(c.uploads, slot);
  totals.uploadMb += cell(c.uploadMb, slot);
  totals.compiles += cell(c.compiles, slot);
  totals.rebuilds += cell(c.rebuilds, slot);
  totals.retakes += cell(c.retakes, slot);
}

/**
 * Adds what only a drawn frame has: its passes, draws and filters.
 *
 * @param totals - The sums.
 * @param c - The ring's columns.
 * @param slot - The frame's slot.
 */
function addDrawn(totals: Totals, c: PerfRing["columns"], slot: number): void {
  totals.drawn += 1;
  totals.passes += cell(c.passes, slot);
  totals.passesMax = Math.max(totals.passesMax, cell(c.passes, slot));
  totals.stencil += cell(c.stencilPasses, slot);
  totals.draws += cell(c.draws, slot);
  totals.drawsMax = Math.max(totals.drawsMax, cell(c.draws, slot));
  totals.applies += cell(c.filterApplies, slot);
  totals.appliesMax = Math.max(totals.appliesMax, cell(c.filterApplies, slot));
  totals.mpx += cell(c.filterMpx, slot);
  totals.keptMax = Math.max(totals.keptMax, cell(c.kept, slot));
}

/**
 * Adds up the frames of a window.
 *
 * @param pc - The perf context.
 * @param window - The window.
 * @param window.first - Its first age.
 * @param window.count - Its frames.
 * @returns The sums.
 */
function totalsOf(pc: PerfCtx, window: { first: number; count: number }): Totals {
  const { ring } = pc.perf;
  const c = ring.columns;
  const totals: Totals = {
    drawn: 0,
    idle: 0,
    skipped: 0,
    missed: 0,
    missedDrawn: 0,
    overBudget: 0,
    spikes: 0,
    phaseSum: new Float64Array(PHASE_STRIDE + 2),
    phaseMax: new Float64Array(PHASE_STRIDE + 2),
    passes: 0,
    passesMax: 0,
    stencil: 0,
    draws: 0,
    drawsMax: 0,
    applies: 0,
    appliesMax: 0,
    mpx: 0,
    uploads: 0,
    uploadMb: 0,
    compiles: 0,
    rebuilds: 0,
    keptMax: 0,
    retakes: 0
  };

  for (let age = window.first; age < window.first + window.count; age += 1) {
    const slot = slotAt(ring, age);

    addFrame(totals, c, slot);

    if (cell(c.drawn, slot) === 1) addDrawn(totals, c, slot);
  }

  return totals;
}

/**
 * The five world systems of the second with the highest mean, with their slowest run; `null` without a timing table.
 *
 * @param pc - The perf context.
 * @param frames - Frames of the window.
 * @returns The systems, or `null`.
 */
function systemsOfSecond(
  pc: PerfCtx,
  frames: number
): { name: string; mean: number; max: number }[] | null {
  const timing = pc.ctx.deps.world.systemTimes();

  if (timing === undefined) return null;

  const { secSum, secMax } = pc.perf;

  return timing.names
    .slice(0, secSum.length)
    .map((name, index) => ({
      name,
      mean: frames === 0 ? 0 : cell(secSum, index) / frames,
      max: cell(secMax, index)
    }))
    .filter(system => system.mean > 0)
    .toSorted((first, second) => second.mean - first.mean)
    .slice(0, 5)
    .map(system => ({ name: system.name, mean: ms(system.mean), max: ms(system.max) }));
}

/**
 * The long frames that started in a window: how many, the longest, their blocking time.
 *
 * @param pc - The perf context.
 * @param start - The window's start.
 * @param end - Its end.
 * @returns The summary, or `null` where the browser reports no long frames.
 */
function longFramesOfSecond(
  pc: PerfCtx,
  start: number,
  end: number
): { count: number; maxMs: number; blockingMs: number | null } | null {
  const ring = pc.perf.longFrames;

  if (ring.type === undefined) return null;

  const records = longFramesIn(ring, start, end).filter(record => record.startMs >= start);
  let blocking = 0;
  let longest = 0;

  for (const record of records) {
    blocking += record.blockingMs;
    longest = Math.max(longest, record.durationMs);
  }

  return {
    count: records.length,
    maxMs: ms(longest),
    blockingMs: ring.type === "longtask" ? null : ms(blocking)
  };
}

/**
 * A sum per drawn frame.
 *
 * @param sum - The sum over the drawn frames.
 * @param drawn - How many were drawn.
 * @returns The mean with 2 decimals, 0 without a drawn frame.
 * @example
 * ```ts
 * perDrawn(9, 3); // 3
 * ```
 */
function perDrawn(sum: number, drawn: number): number {
  return drawn === 0 ? 0 : ms(sum / drawn);
}

/**
 * The GPU time of a window's frames that have one.
 *
 * @param pc - The perf context.
 * @param window - The window.
 * @param window.first - Its first age.
 * @param window.count - Its frames.
 * @returns The spread and the frames it was taken over.
 */
function gpuOfSecond(
  pc: PerfCtx,
  window: { first: number; count: number }
): { p50: number; p90: number; max: number; frames: number } {
  const { columns } = pc.perf.ring;
  const gpu = sortedOf(pc, window, slot => cell(columns.gpuMs, slot));

  return {
    p50: rank(gpu.sorted, gpu.count, 0.5),
    p90: rank(gpu.sorted, gpu.count, 0.9),
    max: rank(gpu.sorted, gpu.count, 1),
    frames: gpu.count
  };
}

/**
 * The render passes per drawn frame of a window; stencil passes where the backend measures them.
 *
 * @param totals - The sums of the window.
 * @param bits - What this application measures.
 * @returns Mean, most, and stencil passes per drawn frame.
 */
function passesOfSecond(
  totals: Totals,
  bits: number
): { mean: number; max: number; stencil: number | null } {
  return {
    mean: perDrawn(totals.passes, totals.drawn),
    max: totals.passesMax,
    stencil: (bits & MEASURE.stencilPasses) === 0 ? null : perDrawn(totals.stencil, totals.drawn)
  };
}

/**
 * The sample of one window: counts, gaps, work, phases, systems, the GPU, passes, draws, filters, uploads, compiles,
 * long frames, heap, textures and what measuring cost.
 *
 * @param pc - The perf context.
 * @param start - The window's start, page clock.
 * @param end - Its end.
 * @returns A fresh sample.
 */
export function sampleLine(pc: PerfCtx, start: number, end: number): PerfSampleLine {
  const { perf, deps } = pc;
  const { ring } = perf;
  const c = ring.columns;
  const window = windowOf(ring, start, end);
  const frames = window.count;
  const totals = totalsOf(pc, window);
  const bits = perf.measuring;
  const counted = (bits & MEASURE.counted) !== 0;
  const work = sortedOf(pc, window, slot => cell(c.workMs, slot));
  const workP50 = rank(work.sorted, work.count, 0.5);
  const workP90 = rank(work.sorted, work.count, 0.9);
  const workMax = rank(work.sorted, work.count, 1);
  const gaps = sortedOf(pc, window, slot => cell(c.gapMs, slot));
  const gapP50 = rank(gaps.sorted, gaps.count, 0.5);
  const gapP90 = rank(gaps.sorted, gaps.count, 0.9);
  const gapP99 = rank(gaps.sorted, gaps.count, 0.99);
  const usage = deps.host.textures();
  const counts = deps.sync.counts();
  const drawn = totals.drawn;
  const phase = (index: number): { mean: number; max: number } =>
    meanMax(cell(totals.phaseSum, index), frames, cell(totals.phaseMax, index));

  return {
    v: PERF_LOG_VERSION,
    kind: "sample",
    t: epochOf(end),
    build: buildId(),
    frame: frames === 0 ? 0 : cell(c.frame, slotAt(ring, window.first)),
    windowMs: ms(end - start),
    path: ring.paths[perf.pathId] ?? OVERFLOW_PATH,
    ticks: frames + totals.skipped,
    frames,
    drawn,
    idle: totals.idle,
    gaps: {
      missed: totals.missed,
      drawn: totals.missedDrawn,
      idle: totals.missed - totals.missedDrawn
    },
    gapMs: gaps.count === 0 ? null : { p50: gapP50, p90: gapP90, p99: gapP99 },
    frameHist: [...perf.gapHist],
    workMs: { p50: workP50, p90: workP90, max: workMax },
    overBudget: totals.overBudget,
    phasesMs: {
      start: phase(0),
      input: phase(1),
      animate: phase(2),
      layout: phase(3),
      sync: phase(4),
      signals: phase(5),
      render: phase(6),
      agent: phase(7)
    },
    systems: systemsOfSecond(pc, frames),
    gpuMs: (bits & MEASURE.gpu) === 0 ? null : gpuOfSecond(pc, window),
    passes: (bits & MEASURE.passes) === 0 ? null : passesOfSecond(totals, bits),
    draws: (bits & MEASURE.draws) === 0 ? null : meanMax(totals.draws, drawn, totals.drawsMax),
    filters: counted
      ? {
          applies: meanMax(totals.applies, drawn, totals.appliesMax),
          mpx: perDrawn(totals.mpx, drawn)
        }
      : null,
    uploads: counted ? { count: totals.uploads, mb: ms(totals.uploadMb) } : null,
    compiles: (bits & MEASURE.compiles) === 0 ? null : totals.compiles,
    marks: null,
    rebuilds: perf.produced === 0 ? null : totals.rebuilds,
    longFrames: longFramesOfSecond(pc, start, end),
    heapMb: heapMb(),
    kept: {
      pictures: totals.keptMax,
      mb: roundTo(pc.ctx.state.kept.bytes / BYTES_PER_MB, 2),
      retakes: totals.retakes,
      refreshes: deps.kept.drainRefreshes()
    },
    textures: {
      count: usage.count,
      mb: ms(usage.bytes / BYTES_PER_MB),
      art: ms(usage.art / BYTES_PER_MB),
      targets: ms(usage.targets / BYTES_PER_MB),
      kept: ms(usage.kept / BYTES_PER_MB)
    },
    views: counts.views,
    pooled: counts.pooled,
    resolution: deps.host.resolution(),
    monitorMs: frames === 0 ? 0 : roundTo(perf.listenersSum / frames, 3),
    spikes: totals.spikes
  };
}

/**
 * A spike with everything known about it: its record, its slowest systems, its compiles, its filters per kind, its
 * passes with their GPU time, and the long frames around it.
 *
 * @param pc - The perf context.
 * @param slot - The ring slot of the frame.
 * @returns A fresh spike line.
 */
export function spikeLine(pc: PerfCtx, slot: number): PerfSpikeLine {
  const { ring, longFrames } = pc.perf;
  const record: FrameRecord = recordAt(ring, slot);
  const start = record.gapMs === null ? record.t : record.t - record.gapMs;

  return {
    v: PERF_LOG_VERSION,
    kind: "spike",
    t: epochOf(record.t),
    build: buildId(),
    frame: record,
    systems: record.systems,
    compiles: compilesOf(pc.sinks, record.frame).map(compile => ({
      label: compile.label,
      ms: ms(compile.ms)
    })),
    filters: record.filters?.kinds ?? [],
    passes: passesOf(ring, record.frame),
    longFrames: longFramesIn(longFrames, start, record.t + record.workMs).map(entry =>
      entryOf(entry)
    )
  };
}

/**
 * An event at the moment of the call: the running frame, or `null` between frames.
 *
 * @param name - What happened.
 * @param detail - Plain JSON about it.
 * @param frame - The frame it belongs to, or `null`.
 * @returns A fresh event line.
 */
export function eventLine(
  name: PerfEventName,
  detail: Readonly<Record<string, Json>>,
  frame: number | null
): PerfEventLine {
  return {
    v: PERF_LOG_VERSION,
    kind: "event",
    t: epochOf(pageNow()),
    build: buildId(),
    frame,
    name,
    detail: structuredClone(detail)
  };
}

/**
 * A mark at the moment of the call.
 *
 * @param label - What follows.
 * @param auto - True for the mark of a new rest path.
 * @returns A fresh mark line.
 */
export function markLine(label: string, auto: boolean): PerfMarkLine {
  return {
    v: PERF_LOG_VERSION,
    kind: "mark",
    t: epochOf(pageNow()),
    build: buildId(),
    label,
    auto
  };
}

/**
 * A thermal reading of the native shell as its own line.
 *
 * @param reading - The reading `time:thermal` carried.
 * @returns A fresh thermal line.
 */
export function thermalLine(reading: ThermalReading): PerfThermalLine {
  const model = nativeShell()?.device?.model;

  return {
    v: PERF_LOG_VERSION,
    kind: "thermal",
    t: epochOf(pageNow()),
    build: buildId(),
    status: reading.status,
    headroom: reading.headroom,
    at: reading.at,
    android: reading.android === null ? null : { ...reading.android },
    source: "shell",
    device: typeof model === "string" ? normalizeModel(model) : null,
    batteryC: null,
    sensors: null
  };
}

/**
 * The frames of the ring a long frame overlaps, as the first and the last frame number.
 *
 * @param ring - The ring.
 * @param record - The long frame.
 * @returns The two numbers, or `null` when no frame of the ring overlaps it.
 */
function framesOver(ring: PerfRing, record: LongFrameRecord): readonly [number, number] | null {
  const c = ring.columns;
  const end = record.startMs + record.durationMs;
  let first = Number.NaN;
  let last = Number.NaN;

  for (let age = ring.size - 1; age >= 0; age -= 1) {
    const slot = slotAt(ring, age);
    const t = cell(c.t, slot);

    if (t < end && t + cell(c.workMs, slot) > record.startMs) {
      if (Number.isNaN(first)) first = cell(c.frame, slot);
      last = cell(c.frame, slot);
    }
  }

  return Number.isNaN(first) ? null : [first, last];
}

/**
 * A long frame as its own line, delivered when the observer saw it.
 *
 * @param pc - The perf context.
 * @param record - The long frame.
 * @returns A fresh long-frame line.
 */
export function longFrameLine(pc: PerfCtx, record: LongFrameRecord): PerfLongFrameLine {
  return {
    v: PERF_LOG_VERSION,
    kind: "longFrame",
    t: epochOf(record.startMs),
    build: buildId(),
    ...entryOf(record),
    frames: framesOver(pc.perf.ring, record)
  };
}

/**
 * Kibibytes of a byte count, as the startup line carries them.
 *
 * @param bytes - Bytes.
 * @returns KiB with 2 decimals.
 * @example
 * ```ts
 * kb(2048); // 2
 * ```
 */
export function kb(bytes: number): number {
  return roundTo(bytes / BYTES_PER_KB, 2);
}
