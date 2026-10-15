/**
 * @file renderer/monitor — type definitions: what the renderer tells a tool about its frames.
 */
import type { Json } from "../../model/types";
import type * as Time from "../../time/types";
import type { HostApi, HostInternal } from "../host/types";
import type { KeptStats } from "../kept/types";
import type { SyncApi, SyncInternal } from "../sync/types";
import type { DemandModule, KeptModule, PixiModule, RendererCtx } from "../types";
import type { ViewportApi, ViewportInternal } from "../viewport/types";
import type {
  FrameColumns,
  FrameReadout,
  FrameReadResult,
  FrameRing,
  PerfChange,
  PerfDisplay,
  PerfEventName,
  PerfLogLine,
  PerfStartupLine
} from "./log-types";

/**
 * The counters of the renderer, for a stats panel or a frame-budget check. Plain numbers, so the
 * object goes through `JSON.stringify` as it is.
 *
 * @example
 * ```ts
 * // The board of Timber Town in a dev build: one glowing button on screen, kept as a picture at rest.
 * const stats: RenderStats = {
 *   fps: 60, drawn: 60, frameMs: 3.4, textures: 12, textureMb: 41.25,
 *   textureMbSplit: { art: 30.1, targets: 9.75, kept: 1.4 }, views: 180, pooled: 24,
 *   renderPasses: 1, renderPassesMax: 3, kept: { pictures: 1, mb: 1.4, retakes: 0 }, drawCalls: 14
 * };
 * // The same board at rest with `onDemand`: the loop runs, nothing is drawn.
 * const still: RenderStats = { ...stats, drawn: 0 };
 * // A dev build on a still board with a breathing button: its alpha writes nothing to the path.
 * const breathing: RenderStats = { ...stats, fps: 120, drawn: 120, redraws: 0, rebuilds: 0 };
 * ```
 */
export type RenderStats = {
  /**
   * Frames of the loop per second, measured over the last full second of `clock` time, drawn or
   * not (see `drawn`). 0 before the first second, while inert, and when no frame ran in the last
   * second (a paused clock).
   */
  fps: number;
  /**
   * Frames drawn per second over the same second as `fps`. Equal to `fps` without `onDemand`;
   * with it, 0 on a screen that stands still. 0 before the first second, while inert and while no
   * frame ran.
   */
  drawn: number;
  /**
   * Mean milliseconds of `clock` time one frame took over that second, CPU side: from the
   * renderer's callback in phase `input` to the end of `render`.
   */
  frameMs: number;
  /** Live texture sources on the GPU: Pixi's `renderer.texture.managedTextures`, empty slots skipped. */
  textures: number;
  /** Estimated GPU memory of those sources in MiB: 4 bytes per pixel, every mip level. */
  textureMb: number;
  /**
   * The same memory split into the art a game loaded, the render targets Pixi draws into and the
   * pictures the engine keeps, MiB with 2 decimals; all 0 while inert.
   */
  textureMbSplit: { art: number; targets: number; kept: number };
  /** Display objects `sync` holds for entities. */
  views: number;
  /** Display objects waiting in the pools. */
  pooled: number;
  /**
   * Render passes of the last drawn frame, counted where the GPU begins them (WebGPU) or a new target is bound
   * (WebGL): the canvas, every filter pass, and every kept picture taken or refreshed in that frame. Where nothing
   * counts (headless, a test stage) it is estimated from the filter slots. 0 while inert.
   */
  renderPasses: number;
  /** The most render passes of one drawn frame in the last full second: the frame that took a picture shows here. */
  renderPassesMax: number;
  /**
   * Kept pictures: views drawn as one texture in the last drawn frame, the MiB their textures hold, and the pictures
   * taken in the last full second. `{ pictures: 0, mb: 0, retakes: 0 }` while inert or with `keptMb: 0`.
   */
  kept: KeptStats;
  /**
   * Draw calls of the last drawn frame: a skipped frame keeps the count. Dev and debug builds
   * only, counted on WebGPU: absent in a production build, 0 while inert and on the WebGL
   * fallback.
   */
  drawCalls?: number;
  /**
   * Graphics paths the engine drew in the last second: shapes, clip masks, nine-slice outlines. A still screen draws
   * none. Dev and debug builds only.
   */
  redraws?: number;
  /**
   * Times Pixi rebuilt a render group's instruction list in the last second. A still screen rebuilds none; a fade
   * rebuilds at its start and its end. Dev and debug builds only.
   */
  rebuilds?: number;
};

/**
 * The draw-call counter of a dev build: the draws of the frame being drawn and of the last one.
 * The counting classes close over this one object, so its identity never changes.
 */
export type DrawCounter = { frame: number; last: number };

/**
 * The seven counting subclasses, built from the Pixi module at run time.
 */
export type CountingClasses = {
  /** Counts Pixi's instruction rebuilds, one per `buildStart` (spec 26 R2.3). */
  batcher: PixiModule["BatcherPipe"];
  batch: PixiModule["GpuBatchAdaptor"];
  graphics: PixiModule["GpuGraphicsAdaptor"];
  encoder: PixiModule["GpuEncoderSystem"];
  filter: PixiModule["FilterSystem"];
  gpuTexture: PixiModule["GpuTextureSystem"];
  glTexture: PixiModule["GlTextureSystem"];
};

/**
 * Indices of the per-frame counters in `MonitorSinks.counts`. Not public.
 */
export const COUNT = {
  passes: 0,
  stencilPasses: 1,
  filterApplies: 2,
  filterPixels: 3,
  uploads: 4,
  uploadBytes: 5,
  compiles: 6,
  marks: 7,
  rebuilds: 8
} as const;

/**
 * Filter kinds a frame tells apart; a kind past them counts as `"other"`, which is slot 0. Not
 * public.
 */
export const KIND_SLOTS = 32;

/**
 * What this application measures, as bits of `PerfState.measuring`. Not public.
 */
export const MEASURE = {
  passes: 1,
  stencilPasses: 2,
  draws: 4,
  counted: 8,
  compiles: 16,
  gpu: 32
} as const;

/**
 * One pipeline or program compile a wrapper saw: its frame, its label (by reference) and the CPU
 * time of the creation call. Not public.
 */
export type CompileRecord = { frame: number; label: string | null; ms: number };

/**
 * The last 64 compiles, in pre-made records written in turn, and the shader modules counted for
 * the header. Not public.
 */
export type CompileRing = {
  records: CompileRecord[];
  next: number;
  size: number;
  shaderModules: number;
};

/**
 * A render target as the pass rules read it: the public fields of Pixi's `RenderTarget`. Not
 * public.
 */
export type PassTarget = {
  readonly isRoot: boolean;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly label?: string | undefined;
  readonly colorTexture?: { readonly label?: string | undefined } | undefined;
};

/**
 * What the counting encoder hands each WebGPU pass it begins and each render call it ends. Not
 * public.
 */
export type PassSink = {
  /**
   * Records the pass and, when the GPU timer has a slot, sets its timestamp writes.
   *
   * @param descriptor - The descriptor Pixi built for the pass.
   * @param target - The render target the pass draws into.
   */
  begin(descriptor: GPURenderPassDescriptor, target: PassTarget): void;
  /**
   * Resolves the timestamps of the frame into Pixi's own command buffer.
   *
   * @param commandEncoder - Pixi's command encoder, before it finishes.
   */
  resolve(commandEncoder: GPUCommandEncoder): void;
};

/**
 * The one object the counting classes close over; its identity never changes. Zeros in a
 * production build. Not public.
 */
export type MonitorSinks = {
  draws: DrawCounter;
  /** Per-frame counters, indices `COUNT`, zeroed in `begin()`. */
  counts: Float64Array;
  /** Between `begin()` and the commit; a pass outside a frame is not counted. */
  inFrame: boolean;
  /** Above 0 while the filter system applies a filter: a pass begun then is of kind "filter". */
  filterDepth: number;
  /** Interned kind of the apply running now (0 = "other"); names a pooled target's pass. */
  filterKind: number;
  /** Interned filter kind ids, at most `KIND_SLOTS`, "other" at 0. */
  kindNames: string[];
  /** Applies of each kind in this frame, zeroed in `begin()`. */
  kindApplies: Float64Array;
  /** Pixels of each kind in this frame, zeroed in `begin()`. */
  kindPixels: Float64Array;
  /** The kind of each Pixi filter, `SyncState.filterKinds`, handed over at attach. */
  filterKinds: WeakMap<object, string> | undefined;
  compiles: CompileRing;
  /** The WebGPU pass sink, set at attach. */
  passes: PassSink | undefined;
  /** A pass counter runs (F8): the counting encoder exists, or the WebGL runner items are subscribed. */
  measuring: boolean;
  /** Pixi's instruction rebuilds since the monitor last took them, in a frame or between frames (spec 26 R2.3). */
  rebuildsWindow: number;
};

/**
 * The ring's render passes, written in place: `capacity * 4` of them. Not public.
 */
export type RingPasses = {
  capacity: number;
  size: number;
  newest: number;
  written: number;
  frame: Uint32Array;
  index: Uint8Array;
  kind: Uint8Array;
  stencil: Uint8Array;
  width: Uint16Array;
  height: Uint16Array;
  gpuMs: Float32Array;
  label: (string | null)[];
};

/**
 * The last 64 changes of a frame that had a subject: a scene switched to, a bundle loaded. Not
 * public.
 */
export type EventRing = {
  frames: Uint32Array;
  kinds: Uint8Array;
  whats: (string | null)[];
  next: number;
  size: number;
};

/**
 * The frame ring of the monitor, the object `frames()` answers: the public `FrameRing`, writable
 * here, with the names its columns index. Not public.
 */
export type PerfRing = {
  capacity: number;
  size: number;
  newest: number;
  written: number;
  columns: FrameColumns;
  passes: RingPasses;
  paths: string[];
  /** Interned filter kind names, the sinks' list: `fltKind − 1` indexes it. */
  kindNames: readonly string[];
  /** The world's system names by registration index: `sysIdx` indexes it. */
  systemNames: readonly string[];
  /** The subjects of the changes of recent frames. */
  events: EventRing;
  /** The one answer `read` rewrites. */
  result: FrameReadResult;
  read(into: FrameReadout, since: number): Readonly<FrameReadResult>;
};

/**
 * One script of a Long Animation Frame, the strings by reference. Not public.
 */
export type ScriptRecord = {
  invoker: string;
  type: string;
  source: string;
  fn: string;
  ms: number;
  forcedLayoutMs: number;
};

/**
 * One Long Animation Frame (or long task), times in page-clock ms. Not public.
 */
export type LongFrameRecord = {
  startMs: number;
  durationMs: number;
  blockingMs: number;
  renderStartMs: number;
  styleLayoutMs: number;
  /** Three pre-made records; `scriptCount` of them hold the top scripts by duration. */
  scripts: ScriptRecord[];
  scriptCount: number;
};

/**
 * The last 64 long frames and the observer that delivers them. Not public.
 */
export type LongFrameRing = {
  records: LongFrameRecord[];
  next: number;
  size: number;
  /** The entry type observed; `undefined` where the browser has neither. */
  type: "long-animation-frame" | "longtask" | undefined;
  disconnect: (() => void) | undefined;
};

/**
 * A GPU timer of one application: timestamp queries on WebGPU, the disjoint timer on WebGL. Not
 * public.
 */
export type FrameTimer = {
  readonly kind: "timestamp-query" | "disjoint-timer";
  /**
   * Ties what the timer measured of the frame to its ring slot, sets the slot's `gpuPartial`
   * while a GPU time of it may still come, and polls what landed.
   *
   * @param slot - The ring slot of the frame.
   * @param frame - Its frame number.
   */
  commit(slot: number, frame: number): void;
  /** Hands an open batch to the readback: at a flush. */
  close(): void;
  /** Frees the queries and the buffers. */
  stop(): void;
};

/**
 * The display's frame period guessed from the frame source's ticks, for the budget of a frame while `time` does not know
 * the display. Not public.
 */
export type TickEstimate = {
  /** The last tick intervals of 50 ms or less, written in turn. */
  samples: Float32Array;
  /** Scratch of the median: the samples held, sorted. */
  sorted: Float32Array;
  /** Samples held, at most `samples.length`. */
  size: number;
  /** The slot the next sample goes into. */
  next: number;
  /** `[0]`: the period of the display rate the median snaps to, ms; NaN while it snaps to none. */
  periodMs: Float64Array;
};

/**
 * What the monitor of an agent build keeps. `undefined` in a build without the flag. Not public.
 */
export type PerfState = {
  /** `config.monitor.budgetMs`; a frame's budget is `budgetOf` it. */
  budget: number | "rate";
  /** `config.monitor.frames`: the capacity the ring gets at the first attach. */
  frames: number;
  ring: PerfRing;
  /** `capacity` long, for percentiles at a flush. */
  scratch: Float32Array;
  /** Doubles kept unboxed: `[0]` the budget of the frame being committed, `[1]` the end of a flushed window. */
  staged: Float64Array;
  /** The display's frame period from the ticks: the budget's display part while `time` does not know the display. */
  ticks: TickEstimate;
  /** The `time.rate()` snapshot the last frame saw: a new one may carry another `displayHz` (a `display` event). */
  rate: Readonly<Time.FrameRate> | undefined;
  drawn: boolean;
  /** The `CHANGED` bits of the frame running now. */
  flags: number;
  pathIds: Map<string, number>;
  pathId: number;
  /** The flow path of the last rest, for the auto marks. */
  restPath: string | undefined;
  /** Bits of the counters a producer feeds (rebuilds: B8). */
  produced: number;
  /** What this application measures: `MEASURE` bits, set at attach. */
  measuring: number;
  /** `usedJSHeapSize` at the previous commit (Chromium), NaN elsewhere: the `gc?` hint. */
  lastHeap: number;
  /** Per-system ms of the current second, by registration index. */
  secSum: Float64Array;
  secMax: Float32Array;
  /** `PERF_GAP_BUCKETS` counts of the current second. */
  gapHist: Uint16Array;
  /** Sum of `listenersMs` of the current second: the monitor's own cost. */
  listenersSum: number;
  events: EventRing;
  /** The display last written as a `display` event. */
  display: PerfDisplay | undefined;
  /** Commit numbers of spikes not yet in the stream, oldest first. */
  pending: Float64Array;
  pendingCount: number;
  /** Page clock of the last flush; NaN before the first frame. */
  lastFlushAt: number;
  /** Agent phase time since the last commit. */
  agentMs: number;
  /** Page clock of an open `beginAgent()`; NaN when no span is open. */
  agentStart: number;
  /** The frame running now, or the next one between frames. */
  frame: number;
  listeners: Array<(line: PerfLogLine) => void>;
  /** Subscribed while the native shell had not answered: their header waits for it. */
  waiting: Array<(line: PerfLogLine) => void>;
  /** Listeners that threw once and were warned about. */
  failed: WeakSet<(line: PerfLogLine) => void>;
  /** Whether the header waits for the native shell. */
  shell: "unknown" | "waiting" | "settled";
  startup: PerfStartupLine | undefined;
  /** Page-clock end of the first drawn frame; NaN before. */
  firstDrawnAt: number;
  timer: FrameTimer | undefined;
  longFrames: LongFrameRing;
  /** Per-application removers: runners, wrappers, the timer. */
  detach: Array<() => void>;
  /** The first attach registered the time listener and the observer. */
  attached: boolean;
};

/**
 * Domain context of the performance code of an agent build. Not public.
 */
export type PerfCtx = {
  ctx: RendererCtx;
  deps: MonitorDeps;
  perf: PerfState;
  sinks: MonitorSinks;
};

/**
 * monitor module state: the open measuring window, the last closed one, and the captures that
 * wait for a drawn frame.
 */
export type MonitorState = {
  /** Clock time at the start of the frame being drawn; `undefined` between frames. */
  frameStart: number | undefined;
  /** Clock time at the start of the last frame, the far end of the next interval. */
  lastStart: number | undefined;
  /** Clock milliseconds between frame starts, summed over the open window. */
  windowMs: number;
  /** Intervals between frame starts in the open window. */
  intervals: number;
  /** Clock milliseconds spent inside frames in the open window. */
  workMs: number;
  /** Frames finished in the open window. */
  frames: number;
  /** Frames per second of the last closed window. */
  fps: number;
  /** Intervals of the open window that belong to a drawn frame. */
  drawnIntervals: number;
  /** Drawn frames per second of the last closed window. */
  drawnFps: number;
  /** The last frame that ended was drawn: the interval to the next start is a drawn one. */
  lastDrawn: boolean;
  /** Mean frame work of the last closed window, in milliseconds. */
  frameMs: number;
  /** `Graphics` paths the engine drew in the open window (spec 26 R2.3). */
  redrawsOpen: number;
  /** Pixi's instruction rebuilds in the open window. */
  rebuildsOpen: number;
  /** Paths drawn per second over the last closed window. */
  redraws: number;
  /** Instruction rebuilds per second over the last closed window. */
  rebuilds: number;
  /** Captures waiting for a drawn frame, served in `end()`. */
  captures: PictureRequest[];
  /** The draws the dev counter saw; stays at 0 in a production build. */
  draws: DrawCounter;
  /** What the counting classes write into; zeros in a production build. */
  sinks: MonitorSinks;
  /** The performance monitor of an agent build; `undefined` without the flag. */
  perf: PerfState | undefined;
  /**
   * The measured passes (F8): of the last drawn frame, the most of a frame in the open window, and the most of the
   * last closed one. Zeros until a counter saw a drawn frame.
   */
  passes: { last: number; open: number; max: number };
  /** Removers of the count-only WebGL pass items of a build without the agent flag (F8). */
  passDetach: Array<() => void>;
};

/**
 * monitor module API, on `app.renderer` itself: the counters of the renderer and, in a dev build,
 * a picture of the frame. What the editor's `game.render` source and `game.capture` command read.
 *
 * @example
 * ```ts
 * // A headless test: nothing is drawn, so every counter is 0 and there is no picture.
 * app.renderer.stats(); // { fps: 0, drawn: 0, frameMs: 0, textures: 0, textureMb: 0, textureMbSplit: { art: 0, targets: 0, kept: 0 }, views: 0, pooled: 0, renderPasses: 0, renderPassesMax: 0, kept: { pictures: 0, mb: 0, retakes: 0 } }
 * await app.renderer.capture(); // undefined
 * ```
 */
export type MonitorApi = {
  /**
   * The counters of the renderer, as a fresh object. The frame timing, the draw calls and the
   * render passes are kept each frame without an allocation; the rest is read at call time from
   * `sync`, the kept pictures and Pixi. `renderPasses` is measured on the GPU path in every build
   * (the estimate of the filter slots where nothing counts). `drawCalls`, `redraws` and `rebuilds` are there in a dev
   * build only.
   *
   * @returns Frames per second, frame work, GPU textures and their memory, views, pooled objects,
   *   render passes and their most in the last second, the kept pictures, and in a dev build the
   *   draw calls of the last frame and the Graphics redraws and Pixi rebuilds per second. Inert: all 0.
   * @example
   * ```ts
   * // The editor's stats panel reads it every frame. Here the game drew one sprite for 51 frames,
   * // 20 ms apart with 4 ms of work each, and its texture is not uploaded yet.
   * app.renderer.stats(); // { fps: 50, drawn: 50, frameMs: 4, textures: 0, textureMb: 0, textureMbSplit: { art: 0, targets: 0, kept: 0 }, views: 1, pooled: 0, renderPasses: 1, renderPassesMax: 1, kept: { pictures: 0, mb: 0, retakes: 0 } }
   * // The same frame in a dev build also counts the one sprite batch, and the one instruction build of the first
   * // frame: { ..., drawCalls: 1, redraws: 0, rebuilds: 1 }
   * app.renderer.stats(); // { fps: 120, drawn: 0, … }: a still board with onDemand
   * // the ward at rest with its lamps kept: { renderPasses: 1, renderPassesMax: 1, kept: { pictures: 4, mb: 1.6, retakes: 0 }, … }
   * ```
   */
  stats(): RenderStats;

  /**
   * A PNG of the whole canvas, bars included, taken right after the next frame is drawn, so the
   * picture shows the state the game just reached; at once while the clock is paused, since no
   * frame comes then. Dev builds only: `__MOKU_GAME_DEV__` must be `true`.
   *
   * The options draw on the picture after the extract, on an `OffscreenCanvas`; the game never
   * shows any of it. `layers` hides the other layer containers for the extract alone. `legend`
   * numbers every keyed view the player can see with a badge at the top-left corner of its rect,
   * sorted by `rect.y` then `rect.x`, and lists them. `sheet` takes `frames` pictures `everyMs` of
   * game time apart (while the clock is paused, by one `time.step(everyMs)` each) and lays them out
   * in `ceil(sqrt(frames))` columns. `against` answers the pixel diff: red where a channel differs
   * by more than 24, the current picture faded to grey elsewhere. `legend` combines with `against`;
   * `sheet` combines with `layers` only.
   *
   * @param options - What to draw on the picture; a plain picture when left out.
   * @returns `{ png }`, with `legend` when asked for. `undefined` in a production build, while
   *   inert, lost or unsupported, and when Pixi could not read the frame (logged with
   *   `ctx.log.error`).
   * @throws {Error} When a layer is not in the scene or the list is empty, when a sheet is out of
   *   2 to 12 frames every 1 to 5000 ms or comes with `legend` or `against`, when there is no
   *   `OffscreenCanvas` for an option, when the two pictures of `against` differ in size, and when
   *   game time stood still for 600 drawn frames of a sheet.
   * @example
   * ```ts
   * // The editor's capture button, on the dev page that set globalThis.__MOKU_GAME_DEV__ = true.
   * await app.renderer.capture(); // { png: "data:image/png;base64,iVBORw0KGgo…" }
   * // The same call in a production build.
   * await app.renderer.capture(); // undefined
   * ```
   * @example
   * ```ts
   * // An agent finds the claim button of the HUD on a 1080 x 1920 canvas drawn at resolution 2.
   * await app.renderer.capture({ legend: true });
   * // { png: "data:image/png;base64,…", legend: [{ n: 1, projection: "hud", key: "claim", rect: { x: 1140, y: 2310, w: 567, h: 164 } }] }
   * ```
   * @example
   * ```ts
   * // The coin flight of a merge, six frames 100 ms apart: 3 columns and 2 rows on one picture.
   * await app.renderer.capture({ sheet: { frames: 6, everyMs: 100 } }); // { png: "data:image/png;base64,…" }
   * ```
   */
  capture(options?: CaptureOptions): Promise<Captured | undefined>;
};

/**
 * The performance monitor of an agent build: the log stream, the frame ring, marks, events, agent spans, the resolution switch.
 */
export type PerfMonitorApi = {
  /**
   * Subscribes to the performance log of an agent build: at once the `header` (and the `startup` line once it is
   * measured), then a `sample` every second, `spike` lines for frames over the budget, `longFrame`, `event` and `mark`
   * lines as they happen. The engine sends nothing anywhere: the listener decides. Without the agent flag the listener
   * is never called. Every line is a fresh, frozen object, never reused: a listener may keep it.
   *
   * @param listener - Called with each line, synchronously.
   * @returns The unsubscribe; a second call does nothing.
   * @example
   * ```ts
   * // The editor's recorder in a debug build of the game on the phone.
   * const lines: PerfLogLine[] = [];
   * const off = app.renderer.monitor.stream(line => lines.push(line));
   * lines[0]?.kind; // "header"
   * off();
   * ```
   */
  stream(listener: (line: PerfLogLine) => void): () => void;
  /**
   * The ring of the most recent frames, as typed-array columns: the same object on every call, written in place every
   * frame. `capacity` is `renderer.monitor.frames` in an agent build and 0 otherwise. Read it, never write it.
   *
   * @returns The ring.
   * @example
   * ```ts
   * const ring = app.renderer.monitor.frames();
   * ring.size; // 1024 after nine seconds at 120 fps; 0 in a production build
   * ring.columns.workMs[ring.newest]; // 3.4
   * ```
   */
  frames(): FrameRing;
  /**
   * Writes a mark into the log, so what follows has a name. Agent builds only; nothing otherwise.
   *
   * @param label - What follows: "shop open", "pan run start".
   * @example
   * ```ts
   * app.renderer.monitor.mark("shop open");
   * // a listener of stream() gets { v: 1, kind: "mark", label: "shop open", auto: false, … }
   * ```
   */
  mark(label: string): void;
  /**
   * Writes an event into the log at the frame it happens in. The engine's own plugins call it for a scene switch and a
   * bundle load or unload; the diagnostic switches for a switch; the editor for a command it ran and its recorder. A
   * thermal reading is not an event: it is its own `thermal` line. Agent builds only; nothing otherwise.
   *
   * @param name - What happened.
   * @param detail - Plain JSON about it; `{}` when left out.
   * @example
   * ```ts
   * // assets, right after a bundle of the episode finished loading:
   * ctx.require(rendererPlugin).monitor.event("bundle", { bundle: "ep01", action: "load", tier: "lazy", mb: 12.5, reason: "enter" });
   * ```
   */
  event(name: PerfEventName, detail?: Readonly<Record<string, Json>>): void;
  /**
   * Brackets work of the editor's overlay or page agent, so it is measured as a phase of its own (`agentMs`) and left
   * out of the spike rule and of the adaptive frame rate's work. A begin while a span is open, and an end without one,
   * are ignored. Agent builds only; nothing otherwise.
   *
   * @example
   * ```ts
   * app.renderer.monitor.beginAgent();
   * drawGraph(app.renderer.monitor.frames());
   * app.renderer.monitor.endAgent(); // the next frame record has phases.agent 0.07
   * ```
   */
  beginAgent(): void;
  /**
   * Closes the span `beginAgent` opened and charges it to the frame (`time.chargeAgent`).
   *
   * @example
   * ```ts
   * app.renderer.monitor.beginAgent();
   * drawGraph(app.renderer.monitor.frames());
   * app.renderer.monitor.endAgent();
   * frameAt(app.renderer.monitor.frames(), 0)?.phases.agent; // 0.07
   * ```
   */
  endAgent(): void;
  /**
   * The A/B switch of a debug build: draws at `resolution` from the next frame on, whatever `maxResolution` and the
   * device say; `undefined` hands the choice back to them. Agent builds only; otherwise it changes nothing and answers
   * the current resolution.
   *
   * @param resolution - Device pixels per CSS pixel, 0.5 to 4; `undefined` to go back.
   * @returns The resolution the next frame draws at.
   * @throws {RangeError} When `resolution` is not a number from 0.5 to 4.
   * @example
   * ```ts
   * app.renderer.monitor.setResolution(1.75); // 1.75
   * app.renderer.monitor.setResolution(undefined); // 2
   * ```
   */
  setResolution(resolution: number | undefined): number;
};

/**
 * monitor methods the frame and the hooks drive. Not public.
 */
export type MonitorInternal = {
  /**
   * Marks the start of a frame: closes an interval of the measuring window and starts the draw
   * count of the frame at 0; an agent build also zeroes the frame's counters.
   */
  begin(): void;

  /**
   * Marks the end of a frame: adds its work to the window, closes the draw count, and hands a
   * drawn frame to the captures that wait for it. A skipped frame keeps the draw count of the last
   * drawn one, and serves no capture.
   *
   * @param drawn - True when the render phase drew the frame.
   */
  end(drawn: boolean): void;

  /**
   * Tells whether a capture waits for a drawn frame: the render phase then draws one.
   *
   * @returns True while a capture waits.
   */
  waiting(): boolean;

  /**
   * Notes a change of the frame running now, for its record. Agent builds only.
   *
   * @param change - What changed.
   */
  changed(change: PerfChange): void;

  /**
   * Attaches the measurement to the application that draws now: at the first ready and after
   * every restore. Agent builds only.
   */
  attach(): void;

  /**
   * Attaches the count-only WebGL pass items of a build without the agent flag (F8), at the first
   * ready and after every restore; an agent build counts through `attach`, and WebGPU through the
   * encoder `host` installed.
   */
  attachPasses(): void;

  /**
   * Writes the partial second of a sample now, as a pause does. Agent builds only.
   */
  flush(): void;

  /**
   * Adds to a counter only a producer feeds (B8 in block 4). Agent builds only.
   *
   * @param counter - The counter.
   * @param amount - What to add.
   */
  count(counter: "rebuilds", amount: number): void;

  /**
   * Notes the flow path of the frames from now on; a rest on a new path also writes an auto mark.
   * Agent builds only.
   *
   * @param path - The flow path.
   * @param rest - True when the flow came to rest there.
   */
  path(path: string, rest: boolean): void;

  /**
   * Writes a thermal line from a reading of the native shell. Agent builds only.
   *
   * @param reading - The reading `time:thermal` carried.
   */
  thermal(reading: Time.ThermalReading): void;

  /**
   * Writes the pause or resume event of a change of the pause stack and, on a pause, the partial
   * second. Agent builds only.
   *
   * @param reasons - The pause reasons now.
   * @param paused - True when the clock just paused.
   * @param resumed - True when it just resumed.
   */
  pauses(reasons: readonly string[], paused: boolean, resumed: boolean): void;
};

/**
 * What `monitor` gets injected: the modules it reads its counters from and places a legend with.
 */
export type MonitorDeps = {
  host: HostApi & HostInternal;
  viewport: ViewportApi & ViewportInternal;
  sync: SyncApi & SyncInternal;
  /** The draw decision of the frame, for the `marks` and `reason` columns of the ring. */
  demand: DemandModule;
  /** The kept pictures, for `stats().kept` and the ring's `kept` and `retakes` columns. */
  kept: KeptModule;
};

/**
 * Domain context of the capture: the plugin context and the injected modules.
 */
export type MonitorCtx = { ctx: RendererCtx; deps: MonitorDeps };

/**
 * A rectangle in picture pixels, from the top-left corner of the PNG: CSS pixels of the canvas
 * times the resolution, so an agent draws on the picture with it.
 *
 * @example
 * ```ts
 * // The claim button of the HUD on a 1080 x 1920 canvas drawn at resolution 2.
 * const rect: PictureRect = { x: 1140, y: 2310, w: 567, h: 164 };
 * ```
 */
export type PictureRect = { x: number; y: number; w: number; h: number };

/**
 * One numbered view of a legend: the number on its badge, the projection and key that address
 * it, and its rect on the picture.
 *
 * @example
 * ```ts
 * const entry: LegendEntry = {
 *   n: 1, projection: "hud", key: "claim", rect: { x: 1140, y: 2310, w: 567, h: 164 }
 * };
 * ```
 */
export type LegendEntry = { n: number; projection: string; key: string; rect: PictureRect };

/**
 * What `capture()` draws on the picture. Every field is optional; none gives a plain picture.
 *
 * @example
 * ```ts
 * // The numbered board without the HUD over it.
 * const options: CaptureOptions = { legend: true, layers: ["board", "items"] };
 * // Six frames of a motion, 100 ms of game time apart.
 * const sheet: CaptureOptions = { sheet: { frames: 6, everyMs: 100 } };
 * ```
 */
export type CaptureOptions = {
  /** Number every keyed view on the picture and list them in `legend` of the answer. */
  legend?: boolean;
  /** Draw only these layers of the scene; a `Parent` child follows its parent's layer. */
  layers?: readonly string[];
  /** A contact sheet: 2 to 12 frames, every 1 to 5000 ms of game time. */
  sheet?: { frames: number; everyMs: number };
  /** A PNG data URL of an earlier capture: the answer is the pixel diff against it. */
  against?: string;
};

/**
 * What `capture()` answers: the picture, and the legend when it was asked for.
 *
 * @example
 * ```ts
 * const plain: Captured = { png: "data:image/png;base64,iVBORw0KGgo=" };
 * const numbered: Captured = {
 *   png: "data:image/png;base64,iVBORw0KGgo=",
 *   legend: [{ n: 1, projection: "hud", key: "claim", rect: { x: 1140, y: 2310, w: 567, h: 164 } }]
 * };
 * ```
 */
export type Captured = { png: string; legend?: readonly LegendEntry[] };

/**
 * A picture as RGBA bytes, the way `ImageData` holds it. Not public.
 */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/**
 * Where the cells of a contact sheet go: the grid, the scale of a cell, the size of the sheet and
 * the rect of every cell, in sheet pixels. Not public.
 */
export type SheetLayout = {
  columns: number;
  rows: number;
  scale: number;
  width: number;
  height: number;
  cells: PictureRect[];
};

/**
 * The picture of one drawn frame, the legend measured on that same frame when it was asked for,
 * and the game time of the frame. Not public.
 */
export type Shot = { png: string; legend: LegendEntry[] | undefined; elapsed: number };

/**
 * A capture waiting for a drawn frame. Not public.
 */
export type PictureRequest = {
  /** The layers to draw; every layer when `undefined`. */
  layers: readonly string[] | undefined;
  /** True to measure the legend on the frame of the picture. */
  legend: boolean;
  /** True when the frame just drawn is the one to take. A plain capture takes the next one. */
  due: () => boolean;
  /** Takes the shot instead when the game pauses before that frame came: at once, or stepped. */
  whilePaused: () => Promise<Shot | undefined>;
  /** Drawn frames that went by while `due` said no. */
  waited: number;
  /** Hands the shot over; nothing when the renderer stopped first. */
  resolve: (shot?: Shot) => void;
  /** Hands over why the shot cannot come. */
  reject: (error: Error) => void;
};
