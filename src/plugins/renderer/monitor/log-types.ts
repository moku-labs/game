/**
 * @file renderer/monitor — the schema of the performance log and of the frame ring: what an agent build measures and
 * hands to `monitor.stream` and `monitor.frames`.
 */
import type { Json } from "../../model/types";
import type * as Time from "../../time/types";
import type { Entity } from "../../world/types";
import type { OverlayMode } from "../sync/types";

/**
 * The frame ring's columns: one typed array per measure, indexed by slot.
 *
 * @example
 * ```ts
 * ring.columns.workMs[ring.newest]; // 3.4
 * ```
 */
export type FrameColumns = {
  frame: Uint32Array;
  t: Float64Array;
  gapMs: Float32Array;
  capMs: Float32Array;
  skipped: Uint8Array;
  startMs: Float32Array;
  /** `FrameMeasure.rateMs`: one frame of the loop's rate, the default spike budget (R8.5). */
  rateMs: Float32Array;
  /** The budget the spike rules used for this frame (LEAD-FIXES-2 editor request on 11/21). */
  budgetMs: Float32Array;
  /** `capacity * 6`: slot * 6 + phase index (`PHASES` order). */
  phaseMs: Float32Array;
  /** The agent phase (R8.9). */
  agentMs: Float32Array;
  workMs: Float32Array;
  drawn: Uint8Array;
  idle: Uint8Array;
  stepped: Uint8Array;
  passes: Float32Array;
  stencilPasses: Float32Array;
  draws: Float32Array;
  filterApplies: Float32Array;
  filterMpx: Float32Array;
  uploads: Float32Array;
  uploadMb: Float32Array;
  compiles: Float32Array;
  marks: Float32Array;
  rebuilds: Float32Array;
  gpuMs: Float32Array;
  gpuPartial: Uint8Array;
  path: Uint16Array;
  changed: Uint8Array;
  causes: Uint8Array;
  /** Reserved: the draw reason of spec 14 (`demand.frame().reason`), 255 = not measured. */
  reason: Uint8Array;
  /** `capacity * 5`: the five slowest world systems of the frame (H2b); `0xffff` = empty. */
  sysIdx: Uint16Array;
  sysMs: Float32Array;
  /** `capacity * 4`: the four filter kinds with the most pixels (R4.3). */
  fltKind: Uint8Array;
  fltApplies: Uint16Array;
  fltMpx: Float32Array;
  /** Kept pictures drawn in the frame (spec 23); NaN before attach. */
  kept: Float32Array;
  /** Kept pictures and range pictures taken in the frame; refreshes go to the per-second count only. */
  retakes: Float32Array;
};

/**
 * What `read` did: one object owned by the ring, rewritten by every call (copy the numbers you keep).
 *
 * @example
 * ```ts
 * ring.read(into, cursor); // { copied: 1, lost: 0 }: the one frame since the last read
 * ```
 */
export type FrameReadResult = {
  /** Frames copied into `into`, oldest first. */
  copied: number;
  /** Frames committed after the cursor that this read did not copy: `copied + lost = written − since`. */
  lost: number;
};

/**
 * Caller-owned arrays `read` fills: any subset of the columns, each at least `length` long.
 *
 * @example
 * ```ts
 * const into: FrameReadout = { length: 256, workMs: new Float32Array(256) };
 * ```
 */
export type FrameReadout = Partial<FrameColumns> & { length: number };

/**
 * The ring of the most recent frames of an agent build, as typed-array columns written in place every frame.
 *
 * @example
 * ```ts
 * const ring = app.renderer.monitor.frames();
 * ring.size; // 1024 after nine seconds at 120 fps; 0 in a production build
 * ```
 */
export type FrameRing = {
  /** `renderer.monitor.frames` in an agent build; 0 otherwise. */
  readonly capacity: number;
  /** Records held, at most `capacity`. */
  readonly size: number;
  /** Slot of the newest record; -1 while empty. */
  readonly newest: number;
  /** Frames ever committed; a reader keeps it as its cursor. */
  readonly written: number;
  /** The live columns, written in place: read, never write. */
  readonly columns: FrameColumns;
  /** `capacity * 4` render passes. */
  readonly passes: {
    readonly capacity: number;
    readonly size: number;
    readonly newest: number;
    readonly written: number;
    frame: Uint32Array;
    index: Uint8Array;
    kind: Uint8Array;
    stencil: Uint8Array;
    width: Uint16Array;
    height: Uint16Array;
    gpuMs: Float32Array;
    /** Pre-sized; references, never copies. */
    label: (string | null)[];
  };
  /** Path id → flow path. */
  readonly paths: readonly string[];
  /**
   * Copies the frames committed after the cursor `since` (a `written` value read earlier), oldest first, into the
   * columns `into` provides (`phaseMs` takes 6 values a frame), at most `into.length` of the newest of them. Allocates
   * nothing: the answer is one object the ring rewrites.
   *
   * @param into - The caller's arrays.
   * @param since - The cursor.
   * @returns How many frames it copied and how many it lost.
   * @example
   * ```ts
   * const { copied } = ring.read(into, cursor); // 1: the one frame since the last read
   * ```
   */
  read(into: FrameReadout, since: number): Readonly<FrameReadResult>;
};

/**
 * The version every line carries as `v`.
 */
export const PERF_LOG_VERSION = 1;

/**
 * 81 buckets of a sample's `frameHist`: [0,1) … [49,50) ms, then [50,55) … [195,200) ms, then 200 ms and over.
 */
export const PERF_GAP_BUCKETS = 81;

/**
 * The fields every line has.
 */
type PerfLine<Kind extends string> = {
  v: typeof PERF_LOG_VERSION;
  kind: Kind;
  t: number;
  build: string | null;
};

/**
 * What an agent build could measure on this page; the header lists it.
 */
export type PerfMeasured =
  | "gpu"
  | "passes"
  | "stencilPasses"
  | "draws"
  | "filters"
  | "uploads"
  | "compiles"
  | "marks"
  | "rebuilds"
  | "longFrames"
  | "heap"
  | "systems"
  | "kept";

/**
 * What the screen is: in the header and in every `display` event.
 */
export type PerfDisplay = {
  dpr: number;
  resolution: number;
  maxResolution: number;
  canvas: { w: number; h: number };
  css: { w: number; h: number };
  safeArea: { t: number; r: number; b: number; l: number };
  backend: "webgpu" | "webgl" | "none";
  orientation: "portrait" | "landscape";
};

/**
 * The first line of a log: the page, the device, the GPU, the display and the configuration.
 */
export type PerfHeaderLine = PerfLine<"header"> & {
  timeOrigin: number;
  engine: string | null;
  device: {
    userAgent: string;
    model: string | null;
    modelFrom: "shell" | "ua" | null;
    webview: string | null;
    cores: number | null;
    memoryGb: number | null;
  };
  gpu: {
    backend: "webgpu" | "webgl" | "none";
    vendor: string | null;
    architecture: string | null;
    renderer: string | null;
    timer: "timestamp-query" | "disjoint-timer" | null;
  };
  display: PerfDisplay;
  thermal: Time.ThermalReading | null;
  /** The loop's frame rate when the header was written (spec 21); optional for a reader of an older log. */
  rate?: Readonly<Time.FrameRate>;
  config: {
    maxFps: number;
    idleFps: number;
    budgetMs: number;
    budget: number | "rate";
    frames: number;
  };
  measured: readonly PerfMeasured[];
};

/**
 * One Long Animation Frame (or long task) of the page.
 */
export type LongFrameEntry = {
  startMs: number;
  durationMs: number;
  blockingMs: number | null;
  renderStartMs: number | null;
  styleLayoutMs: number | null;
  scripts: readonly {
    invoker: string;
    type: string;
    source: string;
    fn: string;
    ms: number;
    forcedLayoutMs: number;
  }[];
};

/**
 * How the page started: HTML, script, Pixi, init and the first drawn frame.
 */
export type PerfStartupLine = PerfLine<"startup"> & {
  htmlMs: number | null;
  script: { url: string; fetchEndMs: number; transferKb: number; decodedKb: number } | null;
  parseMs: number | null;
  evaluateMs: number | null;
  pixiMs: number | null;
  initMs: number | null;
  firstFrameMs: number;
  longFrames: {
    count: number;
    totalMs: number;
    maxMs: number;
    blockingMs: number | null;
    top: readonly LongFrameEntry[];
  } | null;
};

/**
 * Median, 90th percentile and maximum of a window.
 */
type Spread = { p50: number; p90: number; max: number };

/**
 * Mean and maximum of a window.
 */
type MeanMax = { mean: number; max: number };

/**
 * One second of frames.
 */
export type PerfSampleLine = PerfLine<"sample"> & {
  frame: number;
  windowMs: number;
  path: string;
  ticks: number;
  frames: number;
  drawn: number;
  idle: number;
  gaps: { missed: number; drawn: number; idle: number };
  gapMs: { p50: number; p90: number; p99: number } | null;
  frameHist: readonly number[];
  workMs: Spread;
  overBudget: number;
  phasesMs: {
    start: MeanMax;
    input: MeanMax;
    animate: MeanMax;
    layout: MeanMax;
    sync: MeanMax;
    signals: MeanMax;
    render: MeanMax;
    agent: MeanMax;
  };
  systems: readonly { name: string; mean: number; max: number }[] | null;
  gpuMs: (Spread & { frames: number }) | null;
  passes: { mean: number; max: number; stencil: number | null } | null;
  draws: MeanMax | null;
  filters: { applies: MeanMax; mpx: number } | null;
  uploads: { count: number; mb: number } | null;
  compiles: number | null;
  marks: MeanMax | null;
  rebuilds: number | null;
  longFrames: { count: number; maxMs: number; blockingMs: number | null } | null;
  heapMb: number | null;
  textures: { count: number; mb: number; art: number; targets: number; kept: number };
  /** Kept pictures: the most drawn in a frame, their MiB, the takes and the stage-3 refreshes of the second. */
  kept: { pictures: number; mb: number; retakes: number; refreshes: number } | null;
  views: number;
  pooled: number;
  resolution: number;
  monitorMs: number;
  spikes: number;
};

/**
 * Why a frame is a spike.
 */
export type PerfCause = "gap" | "js" | "gpu" | "compile" | "upload" | "longFrame" | "gc?";

/**
 * What changed in a frame.
 */
export type PerfChange = "resize" | "resolution" | "scene" | "bundle" | "restore";

/**
 * A change of a frame and, where an event named it, its subject.
 */
export type PerfChangeEntry = { kind: PerfChange; what: string | null };

/**
 * One slot of the ring as a plain record (`frameAt`).
 */
export type FrameRecord = {
  frame: number;
  t: number;
  gapMs: number | null;
  capMs: number;
  rateMs: number;
  /** The budget the spike rules used for this frame. */
  budgetMs: number;
  skipped: number;
  startMs: number;
  phases: {
    input: number;
    animate: number;
    layout: number;
    sync: number;
    signals: number;
    render: number;
    agent: number;
  };
  workMs: number;
  drawn: boolean;
  idle: boolean;
  stepped: boolean;
  reason: string | null;
  passes: number | null;
  stencilPasses: number | null;
  draws: number | null;
  filters: {
    applies: number;
    mpx: number;
    kinds: readonly { kind: string; applies: number; mpx: number }[];
  } | null;
  uploads: { count: number; mb: number } | null;
  compiles: number | null;
  marks: number | null;
  rebuilds: number | null;
  systems: readonly { name: string; ms: number }[] | null;
  gpuMs: number | null;
  gpuPartial: boolean;
  path: string;
  changed: readonly PerfChangeEntry[];
  causes: readonly PerfCause[];
  /** Kept pictures drawn and taken in the frame (spec 23). */
  kept: { pictures: number; retakes: number } | null;
};

/**
 * The kind of a render pass.
 */
export type PassKind = "canvas" | "texture" | "filter";

/**
 * One render pass of a spike frame.
 */
export type PassRecord = {
  index: number;
  kind: PassKind;
  label: string | null;
  stencil: boolean | null;
  w: number;
  h: number;
  gpuMs: number | null;
};

/**
 * A frame over the budget, with its detail.
 */
export type PerfSpikeLine = PerfLine<"spike"> & {
  frame: FrameRecord;
  systems: readonly { name: string; ms: number }[] | null;
  compiles: readonly { label: string | null; ms: number }[];
  filters: readonly { kind: string; applies: number; mpx: number }[];
  passes: readonly PassRecord[];
  longFrames: readonly LongFrameEntry[];
};

/**
 * A Long Animation Frame as its own line.
 */
export type PerfLongFrameLine = PerfLine<"longFrame"> &
  LongFrameEntry & { frames: readonly [number, number] | null };

/**
 * The names of `event` lines (`"devtools"` is the editor's overlay event, in 2b because the editor's page agent emits
 * it on the 2b debug build; `"pool-trim"` is the pool trim of spec 25, detail `PoolTrimDetail`; the 3B/4 addendum
 * adds `"warm"`).
 */
export type PerfEventName =
  | "scene"
  | "overlay"
  | "bundle"
  | "compile"
  | "upload"
  | "resolution"
  | "device-lost"
  | "device-restored"
  | "pause"
  | "resume"
  | "switch"
  | "display"
  | "command"
  | "recorder"
  | "rate"
  | "devtools"
  | "pool-trim";

/**
 * What an `overlay` event line says happened to an overlay (spec 22 O10.2): it opened, landed (its enter motion is
 * over), started to leave, is gone, or its range went live or was kept again (the live fallback).
 *
 * @example
 * ```ts
 * const what: OverlayWhat = "landed";
 * ```
 */
export type OverlayWhat = "open" | "landed" | "leave" | "gone" | "live" | "kept";

/**
 * The detail of an `overlay` event line: the marked entity, its view's label, what happened and the overlay's mode
 * then. The editor mirrors it by these names.
 *
 * @example
 * ```ts
 * const detail: OverlayEventDetail = { entity: 1_048_601, label: "Shape#1048601 shop.dim:shopDimLayer", what: "open", mode: "freeze" };
 * ```
 */
export type OverlayEventDetail = {
  entity: Entity;
  label: string;
  what: OverlayWhat;
  mode: OverlayMode;
};

/**
 * The detail of a `pool-trim` event line (spec 25 M1.8): why the renderer gave back the idle render targets of Pixi's
 * texture pool (a still screen, a scene change a `restMs` ago, a pause), and the MiB that freed. The editor mirrors it
 * by these names.
 *
 * @example
 * ```ts
 * const detail: PoolTrimDetail = { reason: "rest", freedMb: 78.8 };
 * ```
 */
export type PoolTrimDetail = { reason: "rest" | "scene" | "pause"; freedMb: number };

/**
 * Something that happened, at the frame it happened in.
 */
export type PerfEventLine = PerfLine<"event"> & {
  /**
   * The frame the event happened in; `null` when it happened between frames (a `game.frameRate`
   * or `time.setRate` switch, a door command): its `t` then lies between the frames around it.
   */
  frame: number | null;
  name: PerfEventName;
  detail: Readonly<Record<string, Json>>;
};

/**
 * A mark: what follows has a name.
 */
export type PerfMarkLine = PerfLine<"mark"> & { label: string; auto: boolean };

/**
 * A thermal reading, written by whoever has it (the shell through `time:thermal`, a collector).
 */
export type PerfThermalLine = PerfLine<"thermal"> &
  Time.ThermalReading & {
    source: "shell" | "collector";
    device: string | null;
    batteryC: number | null;
    sensors: Readonly<Record<string, number>> | null;
  };

/**
 * Lines a collector on the computer writes into the same file; the engine never produces them.
 */
export type PerfCollectorLine = PerfLine<"gfx"> & {
  device: string;
  seconds: number;
  frames: number;
  janky: number;
  fps: number;
  p50: number;
  p90: number;
  p99: number;
  hist: Readonly<Record<string, number>>;
};

/**
 * One line of the performance log.
 *
 * @example
 * ```ts
 * const off = app.renderer.monitor.stream((line: PerfLogLine) => lines.push(line));
 * ```
 */
export type PerfLogLine =
  | PerfHeaderLine
  | PerfStartupLine
  | PerfSampleLine
  | PerfSpikeLine
  | PerfLongFrameLine
  | PerfEventLine
  | PerfMarkLine
  | PerfThermalLine
  | PerfCollectorLine;
