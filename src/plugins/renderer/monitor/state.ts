/* eslint-disable unicorn/no-null -- an empty compile record has no label: `null`, as the log carries it. */
/**
 * @file renderer/monitor — state factory: the measuring window and the captures of every build, the sinks the counting
 * classes write into, and the performance monitor of an agent build.
 */
import type { MonitorConfig } from "../types";
import { PERF_GAP_BUCKETS } from "./log-types";
import { createEventRing, createFrameRing } from "./ring";
import { createTickEstimate } from "./ticks";
import {
  COUNT,
  type CompileRing,
  type CountTable,
  type DrawCounter,
  KIND_SLOTS,
  type LongFrameRing,
  type MonitorSinks,
  type MonitorState,
  OWNER_SLOTS,
  type OwnerTable,
  type PerfState,
  type ProblemState
} from "./types";

/** Compiles the compile ring keeps. */
const COMPILE_SLOTS = 64;

/** Long frames the long-frame ring keeps. */
const LONG_FRAME_SLOTS = 64;

/** Top scripts a long frame keeps. */
const SCRIPT_SLOTS = 3;

/** Spikes waiting for the stream. */
export const PENDING_SLOTS = 64;

/** Rows the per-second system accumulators hold before they first grow. */
const SYSTEM_ROWS = 16;

/** The counts plugins may register with `monitor.counts.register`. */
export const COUNT_SLOTS = 16;

/** Drawn frames a filtered view stands still, filtered in every one, before `filter-still` (U5). */
const STILL_FRAMES = 60;

/** Megapixels a still filtered view filters a frame before `filter-still`. */
const STILL_MPX = 0.25;

/** Render targets made and dropped a second that count as churn. */
const CHURN_PER_SECOND = 4;

/** Seconds in a row of churn before `target-churn`. */
const CHURN_SECONDS = 3;

/** A target made this soon after a pool trim is churn, ms. */
const CHURN_AFTER_TRIM_MS = 1000;

/**
 * Creates an empty map. It lives in its own non-exported function because lint rule L5 refuses
 * a collection built inside an exported declaration.
 *
 * @returns An empty map.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Creates an empty weak set. Same reason as `emptyMap`.
 *
 * @returns An empty weak set.
 */
function emptyWeakSet<Value extends WeakKey>(): WeakSet<Value> {
  return new WeakSet();
}

/**
 * Creates an empty set. Same reason as `emptyMap`.
 *
 * @returns An empty set.
 */
function emptySet<Value>(): Set<Value> {
  return new Set();
}

/**
 * Creates the compile ring: 64 pre-made records.
 *
 * @returns The ring, empty.
 */
function createCompileRing(): CompileRing {
  return {
    records: Array.from({ length: COMPILE_SLOTS }, () => ({
      frame: 0,
      label: null,
      ms: 0,
      module: false,
      pass: -1,
      kind: 0,
      owner: 0
    })),
    next: 0,
    size: 0,
    shaderModules: 0,
    written: 0,
    sent: 0
  };
}

/**
 * Creates the owner table of the filter applies: `OWNER_SLOTS` empty slots.
 *
 * @returns The table.
 */
function createOwnerTable(): OwnerTable {
  return {
    ids: new Float64Array(OWNER_SLOTS),
    applies: new Float64Array(OWNER_SLOTS),
    pixels: new Float64Array(OWNER_SLOTS),
    kinds: new Uint8Array(OWNER_SLOTS)
  };
}

/**
 * Creates the count table: room for `COUNT_SLOTS` counts, none registered.
 *
 * @returns The table.
 */
function createCountTable(): CountTable {
  return { names: [], reads: [], failed: emptySet() };
}

/**
 * Creates the problem accumulators with the thresholds of `renderer.monitor`, a key left out at its default: a game
 * that sets `monitor` replaces the whole object (shallow merge).
 *
 * @param config - `renderer.monitor`.
 * @returns The accumulators, no problem open.
 */
export function createProblemState(config: Readonly<MonitorConfig>): ProblemState {
  return {
    thresholds: {
      stillFrames: config.stillFrames ?? STILL_FRAMES,
      stillMpx: config.stillMpx ?? STILL_MPX,
      churnPerSecond: config.churnPerSecond ?? CHURN_PER_SECOND,
      churnSeconds: config.churnSeconds ?? CHURN_SECONDS,
      churnAfterTrimMs: config.churnAfterTrimMs ?? CHURN_AFTER_TRIM_MS
    },
    run: new Float64Array(OWNER_SLOTS),
    runSince: new Float64Array(OWNER_SLOTS),
    secFrames: new Float64Array(OWNER_SLOTS),
    secPixels: new Float64Array(OWNER_SLOTS),
    stillOpen: new Uint8Array(OWNER_SLOTS),
    secTargets: 0,
    idleCreate: false,
    trimCreate: false,
    createFrame: 0,
    trimAt: Number.NaN,
    churnRun: 0,
    churnSince: 0,
    churnOpen: false,
    takes: [emptyMap(), emptyMap()],
    takesFrame: [0, 0],
    retakesOpen: emptySet()
  };
}

/**
 * Creates the long-frame ring: 64 pre-made records with three pre-made scripts each.
 *
 * @returns The ring, empty, observing nothing.
 */
function createLongFrameRing(): LongFrameRing {
  return {
    records: Array.from({ length: LONG_FRAME_SLOTS }, () => ({
      startMs: 0,
      durationMs: 0,
      blockingMs: Number.NaN,
      renderStartMs: Number.NaN,
      styleLayoutMs: Number.NaN,
      scripts: Array.from({ length: SCRIPT_SLOTS }, () => ({
        invoker: "",
        type: "",
        source: "",
        fn: "",
        ms: 0,
        forcedLayoutMs: 0
      })),
      scriptCount: 0
    })),
    next: 0,
    size: 0,
    type: undefined,
    disconnect: undefined
  };
}

/**
 * Creates the sinks the counting classes write into. Its identity never changes; in a production
 * build it stays at zero.
 *
 * @param draws - The draw counter of the monitor state; a fresh one when left out.
 * @returns The sinks.
 */
export function createSinks(draws?: DrawCounter): MonitorSinks {
  return {
    draws: draws ?? { frame: 0, last: 0 },
    counts: new Float64Array(Object.keys(COUNT).length),
    inFrame: false,
    filterDepth: 0,
    filterKind: 0,
    kindNames: ["other"],
    kindApplies: new Float64Array(KIND_SLOTS),
    kindPixels: new Float64Array(KIND_SLOTS),
    filterKinds: undefined,
    filterOwners: undefined,
    filterOwner: 0,
    owners: createOwnerTable(),
    compiles: createCompileRing(),
    passes: undefined,
    measuring: false,
    rebuildsWindow: 0
  };
}

/**
 * Creates the performance monitor of an agent build. Nothing large is allocated here: the ring
 * gets its capacity at the first attach, once per renderer state.
 *
 * @param config - `renderer.monitor`.
 * @param sinks - The sinks of the monitor state.
 * @returns The perf state.
 */
export function createPerfState(config: Readonly<MonitorConfig>, sinks: MonitorSinks): PerfState {
  const events = createEventRing();

  return {
    budget: config.budgetMs,
    frames: config.frames,
    ring: createFrameRing(0, events, sinks.kindNames),
    scratch: new Float32Array(0),
    staged: new Float64Array(2),
    ticks: createTickEstimate(),
    rate: undefined,
    drawn: false,
    flags: 0,
    pathIds: emptyMap(),
    pathId: 0,
    restPath: undefined,
    produced: 0,
    measuring: 0,
    lastHeap: Number.NaN,
    secSum: new Float64Array(SYSTEM_ROWS),
    secMax: new Float32Array(SYSTEM_ROWS),
    gapHist: new Uint16Array(PERF_GAP_BUCKETS),
    listenersSum: 0,
    events,
    display: undefined,
    pending: new Float64Array(PENDING_SLOTS),
    pendingCount: 0,
    lastFlushAt: Number.NaN,
    agentMs: 0,
    agentStart: Number.NaN,
    frame: 0,
    listeners: [],
    waiting: [],
    failed: emptyWeakSet(),
    shell: "unknown",
    startup: undefined,
    firstDrawnAt: Number.NaN,
    firstDrawnFrame: Number.NaN,
    counts: createCountTable(),
    problems: createProblemState(config),
    timer: undefined,
    longFrames: createLongFrameRing(),
    detach: [],
    attached: false
  };
}

/**
 * Creates the initial monitor state: no frame seen, an empty window, no capture waiting, no draw
 * counted, zeroed sinks, and in an agent build the performance monitor.
 *
 * @param config - `renderer.monitor`.
 * @returns The monitor branch of the plugin state.
 */
export function createMonitorState(config: Readonly<MonitorConfig>): MonitorState {
  const draws: DrawCounter = { frame: 0, last: 0 };
  const sinks = createSinks(draws);

  return {
    frameStart: undefined,
    lastStart: undefined,
    windowMs: 0,
    intervals: 0,
    workMs: 0,
    frames: 0,
    fps: 0,
    drawnIntervals: 0,
    drawnFps: 0,
    lastDrawn: false,
    frameMs: 0,
    redrawsOpen: 0,
    rebuildsOpen: 0,
    redraws: 0,
    rebuilds: 0,
    captures: [],
    draws,
    sinks,
    // Inline and positive: Bun folds the guard under a production `define`.
    perf:
      typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__
        ? createPerfState(config, sinks)
        : undefined,
    passes: { last: 0, open: 0, max: 0 },
    passDetach: []
  };
}
