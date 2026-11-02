/**
 * @file renderer/monitor — the schema of the performance log and of the frame ring: what an agent build measures and
 * hands to `monitor.stream` and `monitor.frames`.
 */
import type { Json } from "../../model/types";
import type * as Time from "../../time/types";
import type { Entity } from "../../world/types";
import type { CanvasRestart } from "../reasons";
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
  /** Render targets Pixi created in the frame (WebGPU, counted on the texture system); NaN where not counted. */
  targetsCreated: Float32Array;
  /** Render targets Pixi destroyed in the frame (a pool trim, a resize); NaN where not counted. */
  targetsDestroyed: Float32Array;
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
 * // The filter of the newest pass, from the pass ring: `kind2` is 1-based, 0 is "no filter".
 * const kind2 = ring.passes.kind2[ring.passes.newest] ?? 0; // 2
 * kind2 === 0 ? null : ring.kindNames[kind2 - 1]; // "fog.blur"
 * // The world systems the `sysIdx` column indexes; a new system makes a new array.
 * ring.systemNames[ring.columns.sysIdx[ring.newest * 5] ?? 0]; // "board.looks"
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
    /** The entity whose filter drew the pass; 0 for none (the canvas, a texture pass, a filter no view hangs). */
    owner: Uint32Array;
    /** The filter kind of a filter pass, 1-based into `kindNames` (`kindNames[kind2 - 1]`); 0 for none. */
    kind2: Uint8Array;
    /** The draw count of the frame when the pass began: a pass drew up to the next one's (WebGPU; 0 on WebGL). */
    drawsAt: Uint16Array;
    /** The target's texture format (`"rgba8unorm"`), by reference; `null` when unknown. */
    format: (string | null)[];
    /** The target's resolution; NaN when unknown. */
    resolution: Float32Array;
    /** Why a canvas pass began, an index into `CANVAS_RESTARTS` (WebGPU); 0, `"none"`, for any other pass. */
    restart: Uint8Array;
  };
  /** Path id → flow path. */
  readonly paths: readonly string[];
  /**
   * The interned filter kinds, `"other"` first: `fltKind` and the passes' `kind2` index it 1-based
   * (`kindNames[kind - 1]`), 0 is none. It only grows, at most 32 names.
   */
  readonly kindNames: readonly string[];
  /** The world's system names by registration index (`sysIdx`); a registration makes a new array. */
  readonly systemNames: readonly string[];
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
 * Which groups of the monitor's per-frame work run in an agent build, each on unless switched off (spec 11 R14, the
 * names of the editor's contract, telemetry proposal §2.7): `gpu` the GPU timer; `passes` the pass ring with its stencil
 * count and the draws, filter applies, uploads, instruction rebuilds and render targets the counting classes count;
 * `shaders` the pipeline compiles and shader modules; `problems` the problem rules' accumulators and their judgment;
 * `memory` the heap read of every frame and its `gc?` hint; `systems` the time of every world system and the five
 * slowest of a frame; `nodes` the change marks of the frame and its draw reason; `longFrames` the long frames the
 * browser reports. A section switched off skips its work, and its columns and sample fields read as not measured.
 *
 * @example
 * ```ts
 * // The editor measures the ward without the per-system timing, the rest as it was.
 * const sections: MonitorSections = {
 *   gpu: true, passes: true, shaders: true, problems: true, memory: true, systems: false, nodes: true, longFrames: true
 * };
 * ```
 */
export type MonitorSections = {
  gpu: boolean;
  passes: boolean;
  shaders: boolean;
  problems: boolean;
  memory: boolean;
  systems: boolean;
  nodes: boolean;
  longFrames: boolean;
};

/**
 * The sections of the monitor in their order: the order of a `sections` event's lists and of `sample.sectionsMs`
 * (which adds `base`, the rest of the commit). New sections are only ever appended.
 *
 * @example
 * ```ts
 * // The editor draws one switch per section of the device's monitor, in the engine's order, and greys the ones off.
 * app.renderer.monitor.sections({ systems: false });
 * MONITOR_SECTIONS.filter(section => !app.renderer.monitor.sections()[section]); // ["systems"]
 * ```
 */
export const MONITOR_SECTIONS = [
  "gpu",
  "passes",
  "shaders",
  "problems",
  "memory",
  "systems",
  "nodes",
  "longFrames"
] as const satisfies readonly (keyof MonitorSections)[];

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
  | "kept"
  | "targets";

/**
 * What the screen is: in the header and in every `display` event.
 */
export type PerfDisplay = {
  /**
   * The display's refresh rate `time` learned (`time.rate().displayHz`); `null` until it knows it. The engine always
   * writes it; optional for a reader of an older log.
   */
  hz?: number | null;
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
    /** The Chrome major of an Android WebView (`; wv)` in the user agent) or of the page in the native shell; `null` in a browser. */
    webview: string | null;
    /**
     * The Chrome major of the page, in a browser or a WebView; `null` without `Chrome/` in the user agent (Safari,
     * Firefox). The engine always writes it; optional for a reader of an older log.
     */
    browser?: string | null;
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
  /**
   * The bundle identifier of the app, `"com.mokulabs.timber.debug"` in a native debug build (`__MOKU_GAME_APP__`), so a
   * device stream pairs with its project; `null` on a page without one. The engine always writes it; optional for a
   * reader of an older log.
   */
  app?: { id: string | null };
  /**
   * The debug drawing at the moment of the header: `overdraw` true while the overdraw heat map draws, so the frames that
   * follow are not read as real cost (a `debug` event marks a switch later). Optional for a reader of an older log.
   */
  debug?: { overdraw: boolean };
  /**
   * The sections of the monitor at the moment of the header, as `monitor.sections()` answers them (a `sections` event
   * marks a switch later): a section `measured` lists but `false` here is switched off, not missing. The engine always
   * writes it; optional for a reader of an older log.
   */
  sections?: Readonly<MonitorSections>;
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
 * The live object counts of a sample, read once a second: a count that grows each time a screen is entered and left
 * is a leak. `entities` are the world's live entities, `views` the display objects `sync` holds, `timers` the clock's
 * scheduled moments not yet due, `frameListeners` the `time.onFrame` callbacks, `clockListeners` the `clock.onElapsed`
 * listeners; every count a plugin registered through `monitor.counts.register` sits beside them by its name
 * (`inputListeners`).
 *
 * @example
 * ```ts
 * const counts: PerfCounts = {
 *   entities: 412, views: 180, timers: 1, frameListeners: 9, clockListeners: 2, inputListeners: 6
 * };
 * ```
 */
export type PerfCounts = {
  readonly entities: number;
  readonly views: number;
  readonly timers: number;
  readonly frameListeners: number;
  readonly clockListeners: number;
  readonly [registered: string]: number;
};

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
  /** Frames with the `gap` cause (the spike rule's line, the gaps it does not judge left out), split by drawn / not drawn. */
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
  /** The live object counts of the moment (U3); optional for a reader of an older log. */
  counts?: PerfCounts;
  /**
   * Render targets Pixi created and destroyed in the second (WebGPU); `null` where they are not counted. Not the
   * texture memory of `textures.targets`. Optional for a reader of an older log.
   */
  targets?: { created: number; destroyed: number } | null;
  /**
   * What each section of the monitor cost in the second: page-clock ms its part of the frame commits took, summed over
   * the second, 0 for a section switched off; `base` is the rest of the commits. Pixi-side counting is not timed. A
   * WebView's clock ticks in 0.1 ms, so a part shorter than that adds 0 or 0.1 at a time: the sum over a second is
   * what to read. The engine always writes it; optional for a reader of an older log.
   */
  sectionsMs?: { readonly [Section in keyof MonitorSections | "base"]: number };
};

/**
 * Why a frame is a spike: a rule (`gap`, `js`, `gpu`) or an annotation of a spike. `compile` is a compile in the frame or,
 * for a `gap` spike, in one of the 4 frames before it; `gc?` is a hint, never a certainty.
 */
export type PerfCause = "gap" | "js" | "gpu" | "compile" | "upload" | "longFrame" | "gc?";

/**
 * The spike causes in bit order: bit `1 << index` of the ring's `causes` column is `PERF_CAUSES[index]`. New causes are
 * only ever appended, so a stored bit keeps its meaning.
 *
 * @example
 * ```ts
 * // An overlay names the causes of the newest frame from the ring, without building a record.
 * const ring = app.renderer.monitor.frames();
 * const bits = ring.columns.causes[ring.newest] ?? 0; // 9: a gap spike after a pipeline compile
 * PERF_CAUSES.filter((_cause, index) => (bits & (1 << index)) !== 0); // ["gap", "compile"]
 * ```
 */
export const PERF_CAUSES: readonly PerfCause[] = [
  "gap",
  "js",
  "gpu",
  "compile",
  "upload",
  "longFrame",
  "gc?"
];

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
 * One render pass of a spike frame. The fields after `gpuMs` came with the 0.15 telemetry; a reader of an older log
 * finds them absent.
 */
export type PassRecord = {
  index: number;
  kind: PassKind;
  label: string | null;
  stencil: boolean | null;
  w: number;
  h: number;
  gpuMs: number | null;
  /** The entity whose filter drew the pass; `null` for the canvas, a texture pass and a filter no view hangs. */
  owner?: Entity | null;
  /** The label of the owner's view when the line was built; `null` without an owner or once the view left. */
  view?: string | null;
  /** The kind id of the filter that drew it (`"fog.blur"`), `"other"` for a filter without one; `null` otherwise. */
  filter?: string | null;
  /** The draws issued in the pass (WebGPU); `null` where draws are not counted. */
  draws?: number | null;
  /** The target's texture format; `null` when unknown. */
  format?: string | null;
  /** The target's resolution; `null` when unknown. */
  resolution?: number | null;
  /** The pass took or refreshed a kept picture (its label starts with `kept:`). */
  kept?: boolean;
  /** Why a canvas pass began (WebGPU); absent for any other pass and on WebGL. */
  restart?: CanvasRestart;
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
 * it on the 2b debug build; `"pool-trim"` is the pool trim of spec 25, detail `PoolTrimDetail`; `"warm"` is the end of
 * a pipeline warm-up run of spec 27, detail `WarmDetail`; `"sections"` is a switch of the monitor's sections, detail
 * `{ on, off }`: the names of the sections on and off, in the order of `MONITOR_SECTIONS`; `"scale"` is a move of the
 * render scale of the adaptive frame rate, detail `{ from, to, reason, fps }`; `"scene:build"` is the start of a
 * scene built aside on a live switch (spec 31), detail `{ from, to }`, and the `"scene"` line of its commit carries
 * `buildFrames`, `buildMs` and the budget of a frame it ran with, `budgetMs`, too).
 */
export type PerfEventName =
  | "scene"
  | "scene:build"
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
  | "pool-trim"
  | "warm"
  | "shader"
  | "problem"
  | "debug"
  | "sections"
  | "scale";

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
 * The detail of a `warm` event line (spec 27 P2.3.8): the probe draws a pipeline warm-up run made since its queue last
 * started, written when the queue became empty. The editor mirrors it by this name.
 *
 * @example
 * ```ts
 * // A WebGPU splash: four content subjects and the text, then 13 filters, each in four variants.
 * const detail: WarmDetail = { draws: 72 };
 * ```
 */
export type WarmDetail = { draws: number };

/**
 * What a `shader` event line reports, in its `what`: a render pipeline (WebGPU) or a program (WebGL) created, or a
 * WebGPU shader module compiled. New values are only ever appended.
 *
 * @example
 * ```ts
 * // The editor counts the pipelines of a recording without a switch over strings it does not know.
 * const pipelines = lines.filter(line => line.kind === "event" && line.name === "shader" && line.detail.what === SHADER_WHATS[0]).length; // 14
 * ```
 */
export const SHADER_WHATS = ["compile", "module"] as const;

/**
 * One value of `SHADER_WHATS`.
 *
 * @example
 * ```ts
 * const what: ShaderWhat = "module";
 * ```
 */
export type ShaderWhat = (typeof SHADER_WHATS)[number];

/**
 * The detail of a `shader` event line: one pipeline or program created, or one shader module compiled, in the frame
 * `frame`, written at the flush of its second. `boot` is true up to the first drawn frame (the warm-up and the first
 * screen); `during` names where it happened: the index of the pass of the frame, and the filter, its entity and the
 * label of that entity's view when a filter was applying. A compile of a plain batch has no filter: `owner: null`.
 *
 * @example
 * ```ts
 * // The fog blur of the memory screen compiled its pipeline while it applied on the board's fog layer.
 * const detail: ShaderEventDetail = {
 *   what: "compile", label: "PIXI Pipeline (blur-pass-filter)", ms: 4.2, frame: 1824, boot: false,
 *   during: { pass: 2, filter: "fog.blur", owner: 1_048_601, view: "Sprite#1048601 board.fog:fog" }
 * };
 * ```
 */
export type ShaderEventDetail = {
  what: ShaderWhat;
  label: string | null;
  ms: number;
  frame: number;
  boot: boolean;
  during: {
    pass: number | null;
    filter: string | null;
    owner: Entity | null;
    view: string | null;
  };
};

/**
 * The rules of the `problem` event lines, judged once a second: `filter-still` (a filtered view stood still and was
 * filtered again in every drawn frame), `target-churn` (render targets made and dropped all the time, or right after a
 * pool trim, or while idle), `retakes` (a kept view taken again and again). New rules are only ever appended.
 *
 * @example
 * ```ts
 * // The editor reads the rule of the first problem a recording opened: a fog blur filtered again on a still board.
 * const problems = lines.filter((line): line is PerfEventLine => line.kind === "event" && line.name === "problem");
 * const opened = problems.find(line => line.detail.cleared !== true);
 * PROBLEM_RULES.find(rule => rule === opened?.detail.rule); // "filter-still"
 * ```
 */
export const PROBLEM_RULES = ["filter-still", "target-churn", "retakes"] as const;

/**
 * One value of `PROBLEM_RULES`.
 *
 * @example
 * ```ts
 * const rule: ProblemRule = "target-churn";
 * ```
 */
export type ProblemRule = (typeof PROBLEM_RULES)[number];

/**
 * The detail of a `problem` event line: a rule crossed its threshold. Written once per crossing; the line with
 * `cleared: true` follows when the condition stops. `value` is in the rule's unit (still frames, targets made and
 * dropped per second, takes in two seconds), `since` the frame the run began, `frames` the frames it covers. `reason`
 * says why a still filtered view is not kept (`"budget"`: its take was refused for the kept budget, `"not-eligible"`:
 * the kept policy may not keep it) and which clause of `target-churn` fired (`"rate"`, `"idle"`, `"after-trim"`).
 *
 * @example
 * ```ts
 * // The fog of the board is blurred again in every frame of a still screen: the budget refused its picture.
 * const opened: ProblemEventDetail = {
 *   rule: "filter-still", severity: "warn", owner: 1_048_601, view: "Sprite#1048601 board.fog:fog",
 *   filter: "fog.blur", value: 75, threshold: 60, since: 1700, frames: 75, reason: "budget"
 * };
 * const closed: ProblemEventDetail = {
 *   rule: "filter-still", cleared: true, owner: 1_048_601, view: "Sprite#1048601 board.fog:fog"
 * };
 * ```
 */
export type ProblemEventDetail =
  | {
      rule: ProblemRule;
      severity: "info" | "warn";
      owner: Entity | null;
      view: string | null;
      filter: string | null;
      value: number;
      threshold: number;
      since: number;
      frames: number;
      reason?: "budget" | "not-eligible" | "rate" | "idle" | "after-trim";
    }
  | { rule: ProblemRule; cleared: true; owner: Entity | null; view: string | null };

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
 * A line the editor's collector writes into the computer's copy of a device log for lines the device lost before it
 * sent them; the engine never produces it.
 */
export type PerfGapLine = PerfLine<"gap"> & {
  /** Computer epoch ms at receipt. */
  rx: number;
  device: string | null;
  /** Lines lost. */
  lines: number;
};

/**
 * A line of wired device telemetry (GPU clock and load, CPU and memory per process, heap samples) the editor's
 * collector writes into the computer's copy of a device log while it records; the engine never produces it. The
 * readings are the editor's `DeviceTelemetry` fields as it defines them: the engine passes them as JSON.
 */
export type PerfTelemetryLine = PerfLine<"telemetry"> & {
  /** Computer epoch ms at receipt. */
  rx: number;
  device: string;
  serial: string | null;
  wired: boolean;
  gpu: Json;
  cpu: Json;
  memory: Json;
  heap: Json;
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
  | PerfCollectorLine
  | PerfGapLine
  | PerfTelemetryLine;
