/* eslint-disable unicorn/no-null -- an empty compile record has no label: `null`, as the log carries it. */
/**
 * @file renderer/monitor — state factory: the measuring window and the captures of every build, the sinks the counting
 * classes write into, and the performance monitor of an agent build.
 */
import type { MonitorConfig } from "../types";
import { PERF_GAP_BUCKETS } from "./log-types";
import { createEventRing, createFrameRing } from "./ring";
import {
  COUNT,
  type CompileRing,
  type DrawCounter,
  KIND_SLOTS,
  type LongFrameRing,
  type MonitorSinks,
  type MonitorState,
  type PerfState
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
 * Creates the compile ring: 64 pre-made records.
 *
 * @returns The ring, empty.
 */
function createCompileRing(): CompileRing {
  return {
    records: Array.from({ length: COMPILE_SLOTS }, () => ({ frame: 0, label: null, ms: 0 })),
    next: 0,
    size: 0,
    shaderModules: 0
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
