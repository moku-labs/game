/**
 * @file renderer plugin — shared types of the plugin and its three modules.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Config as GameConfig, Require } from "../../config";
import type { Api as ClockApi } from "../clock/types";
import type { Api as FlowApi } from "../flow/types";
import type { Api as LifecycleApi } from "../lifecycle/types";
import type { Api as TimeApi } from "../time/types";
import type { Entity, Owner, ProjectionKey, Api as WorldApi } from "../world/types";
import type { DemandInternal, DemandState } from "./demand/types";
import type { HostApi, HostInternal, HostState } from "./host/types";
import type { KeptInternal, KeptState } from "./kept/types";
import type { MonitorApi, MonitorInternal, MonitorState, PerfMonitorApi } from "./monitor/types";
import type { DebugSwitches, SyncApi, SyncInternal, SyncState } from "./sync/types";
import type { ViewportApi, ViewportInternal, ViewportState } from "./viewport/types";

/**
 * The part of Pixi the engine uses: the classes `sync` builds views from (a `Rectangle` frames the
 * crop of a `"cover"` sprite), the bitmap-font pieces `fonts.install` needs, the `BitmapText` a
 * plugin above builds through `host.pixi()`, the filter and particle classes `effects` builds
 * through it (a custom filter carries a `GpuProgram` and a `GlProgram` over `defaultFilterVert`),
 * the render textures and matrices the kept pictures are drawn with (an `AlphaFilter` runs their pre-pass), and the
 * extension registry with the seven classes the counting of a dev or debug build swaps
 * (the three WebGPU draw classes, the filter system, both texture systems and the batcher pipe whose `buildStart`
 * begins every instruction rebuild; production swaps the encoder alone, to count the passes) and the bitmap text
 * pipe `host` swaps for one whose SDF shader applies the alpha once (with the WGSL and GLSL shader
 * pieces it compiles that shader from). The module object
 * never arrives through a static import: `config.loadPixi()` returns it, so a game without a screen carries no
 * Pixi in its bundle.
 *
 * @example
 * ```ts
 * const pixi: PixiModule = await import("pixi.js");
 * pixi.Texture.WHITE.width; // 1
 * pixi.GpuBatchAdaptor.extension.name; // "batch"
 * pixi.FilterSystem.extension.name; // "filter"
 * pixi.BatcherPipe.extension.name; // "batch"
 * pixi.BitmapTextPipe.extension.name; // "bitmapText"
 * pixi.defaultFilterVert.startsWith("in vec2 aPosition;"); // true
 * ```
 */
export type PixiModule = Pick<
  typeof import("pixi.js"),
  | "AlphaFilter"
  | "Application"
  | "BatcherPipe"
  | "BitmapFont"
  | "BitmapText"
  | "BitmapTextPipe"
  | "BlurFilter"
  | "Bounds"
  | "Cache"
  | "ColorMatrixFilter"
  | "Container"
  | "DisplacementFilter"
  | "Filter"
  | "FilterSystem"
  | "GlProgram"
  | "GlTextureSystem"
  | "GpuBatchAdaptor"
  | "GpuEncoderSystem"
  | "GpuGraphicsAdaptor"
  | "GpuProgram"
  | "GpuTextureSystem"
  | "Graphics"
  | "Matrix"
  | "NineSliceSprite"
  | "NoiseFilter"
  | "Particle"
  | "ParticleContainer"
  | "Rectangle"
  | "RenderGroupPipe"
  | "RenderTexture"
  | "Shader"
  | "Sprite"
  | "Texture"
  | "TexturePool"
  | "UniformGroup"
  | "bitmapFontTextParser"
  | "bitmapFontXMLStringParser"
  | "colorBit"
  | "colorBitGl"
  | "compileHighShaderGlProgram"
  | "compileHighShaderGpuProgram"
  | "defaultFilterVert"
  | "extensions"
  | "generateTextureBatchBit"
  | "generateTextureBatchBitGl"
  | "getBatchSamplersUniformGroup"
  | "localUniformMSDFBit"
  | "localUniformMSDFBitGl"
  | "mSDFBit"
  | "mSDFBitGl"
  | "roundPixelsBit"
  | "roundPixelsBitGl"
>;

/**
 * One Pixi application: renderer, canvas and stage.
 */
export type PixiApplication = InstanceType<PixiModule["Application"]>;

/**
 * A Pixi display object. `Sprite` and `NineSliceSprite` are containers too, so every view is one.
 */
export type PixiContainer = InstanceType<PixiModule["Container"]>;

/**
 * The axis-aligned box Pixi measures a display object into: what `getBounds` fills. The off-screen test of the
 * demand module keeps one and measures into it.
 */
export type PixiBounds = InstanceType<PixiModule["Bounds"]>;

/**
 * A Pixi sprite.
 */
export type PixiSprite = InstanceType<PixiModule["Sprite"]>;

/**
 * A Pixi nine-slice sprite.
 */
export type PixiNineSliceSprite = InstanceType<PixiModule["NineSliceSprite"]>;

/**
 * A Pixi graphics object: what a `Shape` component is drawn with, and what clips its children.
 */
export type PixiGraphics = InstanceType<PixiModule["Graphics"]>;

/**
 * A Pixi texture. `assets` owns its lifetime; the renderer only makes and destroys it on request.
 */
export type PixiTexture = InstanceType<PixiModule["Texture"]>;

/**
 * A texture Pixi renders into: what a kept picture is drawn into, engine-owned and destroyed by the engine.
 */
export type PixiRenderTexture = InstanceType<PixiModule["RenderTexture"]>;

/**
 * A Pixi rectangle: the `filterArea` the renderer writes on a filtered view, one per entity, written in place.
 */
export type PixiRectangle = InstanceType<PixiModule["Rectangle"]>;

/**
 * A Pixi matrix: a world transform read with `getGlobalTransform`, or the transform of a render.
 */
export type PixiMatrix = InstanceType<PixiModule["Matrix"]>;

/**
 * A Pixi filter: what `effects` builds and `sync.filters.set` hangs on a view. `effects` owns
 * the instance; the renderer only assigns it.
 */
export type PixiFilter = InstanceType<PixiModule["Filter"]>;

/**
 * Pixi's filter system as a filter's `apply` receives it: what a stage or a stand-in draws through.
 *
 * @example
 * ```ts
 * // A stage of the frost draws into a pooled texture from inside the frost's own apply.
 * manager.applyFilter(gauss, last, target, true);
 * ```
 */
export type PixiFilterManager = Parameters<PixiFilter["apply"]>[0];

/**
 * A bitmap font the renderer installed for a font asset key. One per key.
 */
export type PixiBitmapFont = InstanceType<PixiModule["BitmapFont"]>;

/**
 * The parsed shape of a `.fnt` file: what `BitmapFont` is built from.
 */
export type BitmapFontData = ConstructorParameters<PixiModule["BitmapFont"]>[0]["data"];

/**
 * Which backend the one application drew with, or `"none"` while it draws nothing.
 *
 * @example
 * ```ts
 * const kind: RendererKind = "webgpu";
 * ```
 */
export type RendererKind = "webgpu" | "webgl" | "none";

/**
 * renderer plugin events.
 *
 * @example
 * ```ts
 * // A game reports a lost GPU to its analytics; the pause itself is handled by `lifecycle`.
 * createPlugin("gpuReport", {
 *   depends: [rendererPlugin],
 *   hooks: ctx => ({ "renderer:device-lost": ({ kind }) => ctx.log.warn("gpu-lost", { kind }) })
 * }); // a lost WebGPU device logs { kind: "webgpu" }
 * ```
 */
export type Events = {
  /** The GPU device or the WebGL context was lost; the game is paused until the restore lands. */
  "renderer:device-lost": { kind: "webgpu" | "webgl"; reason: string };
};

/**
 * The two numbers that bound the shape of the drawn frame: allowed long side / short side.
 *
 * @example
 * ```ts
 * const aspect: AspectRange = { min: 4 / 3, max: 21 / 9 };
 * ```
 */
export type AspectRange = { min: number; max: number };

/**
 * When the renderer gives back the render targets Pixi's texture pool keeps between frames: the textures of filter
 * passes and of a blur's ping-pong, idle once a frame is drawn. A trim runs strictly between frames.
 *
 * @example
 * ```ts
 * // A game that rests on long reading screens trims sooner and only for a large pool.
 * const trim: PoolTrim = { restMs: 500, aboveMb: 32 };
 * createApp({ pluginConfigs: { renderer: { mount: "#game", onDemand: true, poolTrim: trim } } });
 * // after the shop, the board and the memory screen were seen, half a second of a still board:
 * app.renderer.stats().textureMbSplit.targets; // 91.4 before, 12.6 after the trim
 * ```
 */
export type PoolTrim = {
  /**
   * Clock milliseconds a screen must stand still (no frame drawn, `onDemand`), or must have passed since a scene
   * change, before the pool is trimmed. Default 1000.
   */
  restMs: number;
  /**
   * MiB the render targets must have grown by since the last trim. Less is not worth the re-allocation of the next
   * filtered frame. Default 16. A pause trims whatever grew.
   */
  aboveMb: number;
};

/**
 * renderer plugin config.
 *
 * @example
 * ```ts
 * createApp({
 *   plugins: [...screen],
 *   pluginConfigs: { renderer: { mount: "#game", background: 0x101018, maxResolution: 2 } }
 * });
 * // A debug session keeps every render target of Pixi's pool, as before the trim.
 * createApp({ pluginConfigs: { renderer: { mount: "#game", poolTrim: false } } });
 * // A debug build of the fixture outlines every nine-slice from the first frame.
 * createApp({ pluginConfigs: { renderer: { mount: "#game", debug: { nineSlice: true } } } });
 * // Draw only what changes: a still screen draws nothing.
 * createApp({ pluginConfigs: { renderer: { mount: "#game", onDemand: true }, time: { idleFps: 0 } } });
 * createApp({ pluginConfigs: { renderer: { mount: "#game", keptMb: 32 } } }); // a game with small art
 * // A short splash: two probe draws a frame create the pipelines sooner.
 * createApp({ pluginConfigs: { renderer: { mount: "#game", onDemand: true, warm: 2 } } });
 * ```
 */
export type Config = {
  /** Where the canvas goes: a selector or an element. `undefined` keeps the plugin inert. */
  mount: string | HTMLElement | undefined;
  /** Clear colour. Also the colour of the bars around the frame. */
  background: number;
  /** Antialias the whole canvas. Off by default: pixel art and sprites do not need it. */
  antialias: boolean;
  /**
   * Cap of `devicePixelRatio`. Memory grows with its square. The drawing follows a change of
   * `devicePixelRatio` (a window moved to another screen, a zoom) from the next frame. A player's
   * graphics setting is applied by `renderer.monitor.setResolution` from an effect.
   */
  maxResolution: number;
  /**
   * Gives back the render targets Pixi's pool keeps between frames: at rest, after a scene change, on a pause.
   * `false` keeps them until the app stops, as before.
   */
  poolTrim: PoolTrim | false;
  /** Passed to Pixi. Pixi falls back to WebGL by itself. */
  preference: "webgpu" | "webgl";
  /** Allowed long side / short side of the frame. A window outside it gets bars. */
  aspect: AspectRange;
  /** Display objects kept in all pools together. */
  poolLimit: number;
  /** Text of the unsupported-device screen. */
  unsupportedMessage: string;
  /** Loader seam. Tests pass a fake module. */
  loadPixi: () => Promise<PixiModule>;
  /**
   * Debug drawing and checks at start; a switch left out is off. `app.renderer.sync.debug` switches them while the
   * game runs. `verifyFrames` works in dev and debug builds only.
   */
  debug: Partial<DebugSwitches>;
  /**
   * Draw a frame only when something on the screen changed: a view the engine wrote, a filter value, a plugin's own
   * object it reported, a resize, a wake of `time`, a waiting capture. The loop keeps its rate for input and systems.
   * A game that writes into its own `Display` objects calls `renderer.invalidate(entity)` before it does. Off by
   * default: every frame is drawn, as before.
   */
  onDemand: boolean;
  /** The performance monitor of an agent build: the spike budget and the frames the ring keeps. */
  monitor: MonitorConfig;
  /**
   * MiB the kept pictures may hold: a filtered view whose subtree and filter values did not change is drawn from a texture
   * instead of filtering it again. The least recently drawn picture goes first when the budget is full. 0 keeps none.
   */
  keptMb: number;
  /**
   * Probe draws per drawn frame that create the GPU pipelines the game will need before a screen needs them: sprites,
   * graphics, text, particles and every filter `effects` registers, on the canvas and on a texture, with and without a
   * clip. Drawn before the frame and cleared by it: nothing shows. 0 turns the warm-up off: every pipeline is then
   * created in the first frame that draws with it, as before. A whole number from 0 to 16; default 1.
   */
  warm: number;
};

/**
 * The performance monitor of an agent build (`__MOKU_GAME_AGENT__`: dev and `--debug` builds).
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { renderer: { mount: "#game", monitor: { budgetMs: 8.3, frames: 2048 } } } });
 * ```
 */
export type MonitorConfig = {
  /**
   * A frame over this is a spike. `"rate"` (the default): one frame of the frame's own rate —
   * 8.33 ms at the 120 fps target, 16.7 ms at the 60 fps fallback — so a switch of the rate needs
   * no config change; a number is a fixed budget in ms.
   */
  budgetMs: number | "rate";
  /** Frames the ring keeps in an agent build, 64 to 16384; render passes keep 4x as many. */
  frames: number;
};

/**
 * renderer plugin state: one branch per module.
 */
export type State = {
  host: HostState;
  viewport: ViewportState;
  sync: SyncState;
  monitor: MonitorState;
  demand: DemandState;
  kept: KeptState;
};

/**
 * renderer plugin API, `app.renderer`: grouped by module, and the two members of `monitor`,
 * `stats()` and `capture()`, on the plugin itself.
 *
 * @example
 * ```ts
 * app.renderer.host.kind(); // "webgpu"
 * app.renderer.viewport.size().width; // 1080, reference units
 * app.renderer.sync.hitTest(540, 300, () => true); // 1048576
 * app.renderer.stats().views; // 180
 * app.renderer.stats().renderPasses; // 1: no filter on screen
 * ```
 */
export type Api = {
  /**
   * The one Pixi application: whether it draws, what it draws with, and the canvas it draws on.
   *
   * @example
   * ```ts
   * // A game shows a DOM fallback while nothing can draw: a headless test, the unsupported screen.
   * if (!app.renderer.host.ready()) showFallback();
   * app.renderer.host.kind(); // "webgpu" in Chrome; "none" while inert
   * ```
   */
  host: HostApi;
  /**
   * The drawn frame in reference units, and the mapping between reference units and the page.
   *
   * @example
   * ```ts
   * // A 390 x 844 phone, the canvas at the top left: the 1080 reference units across are 390 CSS pixels.
   * app.renderer.viewport.toScreen({ x: 540, y: 960 }); // { x: 195, y: 346.666… }
   * app.renderer.viewport.toScreen({ x: 1080, y: 0 }).x; // 390
   * ```
   */
  viewport: ViewportApi;
  /**
   * The display objects of the entities: the hit tests, and the textures, displays, fonts and filters other plugins
   * hand the renderer.
   *
   * @example
   * ```ts
   * // The first entity of the world is a sprite drawn at (540, 300); nothing is drawn at (10, 10).
   * app.renderer.sync.hitTest(540, 300, () => true); // 1048576
   * app.renderer.sync.hitTest(10, 10, () => true); // undefined
   * ```
   */
  sync: SyncApi;
  /**
   * The performance monitor of an agent build: the log stream, the frame ring, marks, events, agent spans and the
   * resolution switch.
   *
   * @example
   * ```ts
   * // The editor's frame graph reads the ring of a debug build on the phone; a production build keeps none.
   * app.renderer.monitor.frames().capacity; // 1024 once the debug build draws; 0 in production
   * app.renderer.monitor.mark("shop open"); // a stream() listener gets { kind: "mark", label: "shop open", … }
   * ```
   */
  monitor: PerfMonitorApi;
  /**
   * Tells the renderer that the Pixi object of an entity's view is about to be drawn differently in a way it cannot
   * see: a plugin or a game writes into its own `Display` object or a Pixi object it built, `effects` writes a filter
   * value, particles step. Call it **before** the write: the view is judged as it was last drawn (so a view that
   * leaves the screen or hides itself still gets its frame) and again when the frame is decided (so a view that
   * arrives gets it too). The frame is drawn when the entity's view was or will be seen. There is no whole-frame form
   * (LEAD-FIXES-4): whole frames come from the renderer's own reasons. Writes the renderer makes itself never need
   * it. Without `onDemand` it changes nothing; inert, and for an entity without a view, a no-op.
   *
   * @param entity - The entity whose own Pixi object is about to change.
   * @example
   * ```ts
   * // A game plugin redraws the flame of the stove into the Graphics it owns.
   * const renderer = ctx.require(rendererPlugin);
   * renderer.invalidate(1_048_590); // first: with onDemand this frame is drawn, stats().drawn counts it
   * drawFlame(flame, 0.8); // then the write into the Graphics of the Display on entity 1_048_590
   * ```
   */
  invalidate(entity: Entity): void;
} & MonitorApi;

/**
 * One entity under a point of the page, what the `game.at` door answers: the entity, its owner,
 * the projection and key that address it when it has them, and the layer its own `Layer` names
 * (`undefined` for a `Parent` child, which draws in its parent's layer).
 *
 * @example
 * ```ts
 * // A coin of the board under the pointer.
 * const under: Under = {
 *   entity: 1_048_581, owner: { kind: "projection", name: "board.items" },
 *   key: { projection: "board.items", key: "c7" }, layer: "items"
 * };
 * ```
 */
export type Under = {
  entity: Entity;
  owner: Owner;
  key: ProjectionKey | undefined;
  layer: string | undefined;
};

/**
 * Resolved dependency APIs. `clock` is the time source of the frame counters.
 */
export type Deps = {
  time: TimeApi;
  lifecycle: LifecycleApi;
  world: WorldApi;
  clock: ClockApi;
  /** The flow path of a frame in the performance ring of an agent build. */
  flow: FlowApi;
};

/**
 * What the kernel context offers before the deps are attached.
 *
 * `emit` is the kernel's own: `index.ts` writes `events` with an annotated `register`
 * (core spec `14-EVENT-REGISTRATION.md` row 8), so the plugin's own event reaches the pre-typed
 * `api` factory and no member of this context is cast.
 */
export type KernelSlice = PluginCtx<Config, State, Events> & {
  readonly global: Readonly<GameConfig>;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context shared by the three modules.
 */
export type RendererCtx = KernelSlice & { readonly deps: Deps };

/**
 * Both halves of the `host` module: what a game calls and what the two modules above get injected.
 */
export type HostModule = HostApi & HostInternal;

/**
 * Both halves of the `viewport` module: what a game calls and what `sync` and the frame drive.
 */
export type ViewportModule = ViewportApi & ViewportInternal;

/**
 * Both halves of the `sync` module: what `input` and `assets` call and what the frame drives.
 */
export type SyncModule = SyncApi & SyncInternal;

/**
 * Both halves of the `monitor` module: what a tool calls, the performance monitor of an agent
 * build, and what the frame and the hooks drive.
 */
export type MonitorModule = MonitorApi & PerfMonitorApi & MonitorInternal;

/**
 * The demand module: change marks, the draw decision of the render phase and the oracles. Internal only: the public
 * member is `Api.invalidate`. The one home of this name; every file imports it from here.
 */
export type DemandModule = DemandInternal;

/**
 * The kept module: filtered views drawn from engine-owned pictures, and the range pictures of overlays. Internal only
 * (O18: the same type as `KeptInternal`). The one home of this name; every file imports it from here.
 */
export type KeptModule = KeptInternal;

/**
 * The six modules in injection order.
 */
export type Modules = {
  host: HostModule;
  viewport: ViewportModule;
  demand: DemandModule;
  kept: KeptModule;
  sync: SyncModule;
  monitor: MonitorModule;
};

/**
 * What `onStop` receives: the frozen config and the plugin state, nothing else.
 */
export type TeardownScope = { readonly config: Readonly<Config>; readonly state: State };

export type { HudPartValue, OverlayLevelValue, OverlayValue } from "./components";
export type { DemandFrame, DemandReason, DemandState } from "./demand/types";
export type { HostApi, HostInternal, HostState, TextureUsage } from "./host/types";
export type { FilterCache, KeptInternal, KeptRange, KeptState, KeptStats } from "./kept/types";
export type {
  FrameColumns,
  FrameReadout,
  FrameReadResult,
  FrameRecord,
  FrameRing,
  LongFrameEntry,
  OverlayEventDetail,
  OverlayWhat,
  PassKind,
  PassRecord,
  PerfCause,
  PerfChange,
  PerfChangeEntry,
  PerfCollectorLine,
  PerfDisplay,
  PerfEventLine,
  PerfEventName,
  PerfHeaderLine,
  PerfLogLine,
  PerfLongFrameLine,
  PerfMarkLine,
  PerfMeasured,
  PerfSampleLine,
  PerfSpikeLine,
  PerfStartupLine,
  PerfThermalLine,
  PoolTrimDetail,
  WarmDetail
} from "./monitor/log-types";
export type {
  Captured,
  CaptureOptions,
  CountingClasses,
  DrawCounter,
  LegendEntry,
  MonitorApi,
  MonitorDeps,
  MonitorInternal,
  MonitorState,
  PerfMonitorApi,
  PictureRect,
  RenderStats
} from "./monitor/types";
export type {
  CoverFrame,
  CreateTextureOptions,
  DebugApi,
  DebugSwitches,
  DisplayAdapter,
  DisplayEntry,
  DisplaysApi,
  FilterSlot,
  FilterSlotInputs,
  FiltersApi,
  FontsApi,
  HitBox,
  LayerEntry,
  NineBorders,
  OverlayMode,
  OverlayPhase,
  OverlayReport,
  SliceFrame,
  SyncApi,
  SyncCounts,
  SyncInternal,
  SyncState,
  TextureProvider,
  TexturesApi,
  View,
  ViewKind
} from "./sync/types";
export type {
  Orientation,
  Point,
  Rect,
  SafeArea,
  ViewportApi,
  ViewportInternal,
  ViewportSize,
  ViewportState
} from "./viewport/types";
