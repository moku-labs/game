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
import type { MonitorSections } from "./monitor/log-types";
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
 * begins every instruction rebuild; production swaps the encoder alone, to count the passes), and the pieces of
 * batched distance-field text `host` installs: Pixi's `Batcher` with its geometry and buffers, the bitmap text pipe
 * and the batcher pipe it subclasses, and the WGSL and GLSL shader pieces of the batch's SDF shader, and the WebGPU
 * render target system with its adaptor, the pipeline system and the stencil system the lazy canvas pass of `host`
 * subclasses or registers again (`host/render-pass.ts`), and the mesh and its geometry the rim-only nine-slice of
 * `sync` is drawn with (`sync/hollow.ts`). The module object
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
 * pixi.ExtensionType.Batcher; // "batcher"
 * pixi.defaultFilterVert.startsWith("in vec2 aPosition;"); // true
 * ```
 */
export type PixiModule = Pick<
  typeof import("pixi.js"),
  | "AlphaFilter"
  | "Application"
  | "Batcher"
  | "BatcherPipe"
  | "BitmapFont"
  | "BitmapText"
  | "BitmapTextPipe"
  | "BlurFilter"
  | "Bounds"
  | "Buffer"
  | "BufferUsage"
  | "Cache"
  | "ColorMatrixFilter"
  | "Container"
  | "DefaultBatcher"
  | "DisplacementFilter"
  | "ExtensionType"
  | "Filter"
  | "FilterSystem"
  | "Geometry"
  | "GlProgram"
  | "GlTextureSystem"
  | "GpuBatchAdaptor"
  | "GpuEncoderSystem"
  | "GpuGraphicsAdaptor"
  | "GpuProgram"
  | "GpuRenderTargetAdaptor"
  | "GpuRenderTargetSystem"
  | "GpuStencilSystem"
  | "GpuTextureSystem"
  | "Graphics"
  | "Matrix"
  | "Mesh"
  | "MeshGeometry"
  | "NineSliceSprite"
  | "NoiseFilter"
  | "Particle"
  | "ParticleContainer"
  | "PipelineSystem"
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
 * A Pixi mesh: what the rim-only nine-slice of a `NineSlice` with `hollow: true` is drawn with.
 */
export type PixiMesh = InstanceType<PixiModule["Mesh"]>;

/**
 * A Pixi graphics object: what a `Shape` component is drawn with, and what clips its children.
 */
export type PixiGraphics = InstanceType<PixiModule["Graphics"]>;

/**
 * A Pixi texture. `assets` owns its lifetime; the renderer only makes and destroys it on request.
 */
export type PixiTexture = InstanceType<PixiModule["Texture"]>;

/**
 * The source of a Pixi texture: the pixels the GPU holds once, shared by every slice of an atlas page. What the
 * upload queue of `sync.textures.upload` hands to Pixi's texture system.
 */
export type PixiTextureSource = PixiTexture["source"];

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
 * The render scale the adaptive frame rate may lower on a GPU-bound screen (`time.adaptive` on): before the rate drops,
 * the canvas draws at 0.85, then 0.75 of its resolution, down to `floor`, and back up when there is room again.
 *
 * @example
 * ```ts
 * // The default: on a phone the memory screen draws at 1.5 instead of 2 before it drops to 60 fps.
 * const scale: AdaptiveScale = { floor: 0.75, devices: "phone" };
 * createApp({ pluginConfigs: { renderer: { mount: "#game", adaptiveScale: scale }, time: { maxFps: 120, adaptive: { floor: 60 } } } });
 * ```
 */
export type AdaptiveScale = {
  /** The lowest share of the resolution, a step of the scale: 1, 0.85, 0.75, 0.6 or 0.5. 1 allows none. */
  floor: number;
  /**
   * Where it applies: `"phone"`, a coarse pointer and a short side of at most 820 CSS px (read at start), or `"all"`.
   */
  devices: "phone" | "all";
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
 * // A desktop game with a fast GPU: `assets.warm` puts two textures a drawn frame on the GPU instead of one.
 * createApp({ pluginConfigs: { renderer: { mount: "#game", uploads: 2 } } });
 * // A game whose art must stay sharp: the adaptive frame rate drops the rate, never the resolution.
 * createApp({ pluginConfigs: { renderer: { mount: "#game", adaptiveScale: false } } });
 * ```
 */
export type Config = {
  /**
   * Where the canvas goes: a selector or an element. `undefined` keeps the plugin inert. The canvas takes the
   * mount's border box, fractions of a CSS pixel kept, so the mount has no border, padding, scrollbar or transform.
   */
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
  /**
   * Textures `sync.textures.upload` (what `assets.warm` calls) puts on the GPU per drawn frame, before the stage pass,
   * so the frame that first shows them does not upload them all at once. One upload costs about 9 ms on a Galaxy A26
   * whatever its size (median, 41 ms at worst): the show frame of 6 cold textures (9.4 MB) took 55 ms there, 8 ms with
   * them uploaded before. So the budget counts textures, not bytes. 0 turns the queue off: `upload` answers false and
   * the first draw of a texture uploads it, as before. A whole number from 0 to 8; default 1.
   *
   * @example
   * ```ts
   * // The memory screen's 6 textures, warmed while the board still shows: 3 drawn frames at 2 a frame.
   * const app = createApp({ pluginConfigs: { renderer: { mount: "#game", uploads: 2 } } });
   * await app.start();
   * await app.assets.warm("ep01.memory"); // resolves after the third drawn frame
   * ```
   */
  uploads: number;
  /**
   * The render scale of the adaptive frame rate on a GPU-bound screen: `{ floor: 0.75, devices: "phone" }` by default,
   * `false` keeps the resolution. Needs `time.adaptive`. A player's `monitor.setResolution` wins over it. Every change
   * of the scale redraws the canvas and retakes the kept pictures once.
   */
  adaptiveScale: AdaptiveScale | false;
};

/**
 * The performance monitor of an agent build (`__MOKU_GAME_AGENT__`: dev and `--debug` builds): the spike budget, the
 * ring's frames and the thresholds of the `problem` rules. A threshold left out keeps its default.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { renderer: { mount: "#game", monitor: { budgetMs: 8.3, frames: 2048 } } } });
 * // A game with a large blurred backdrop flags it sooner: 30 still frames over 0.1 Mpx.
 * createApp({ pluginConfigs: { renderer: { mount: "#game", monitor: { budgetMs: "rate", frames: 1024, stillFrames: 30, stillMpx: 0.1 } } } });
 * // A debug build that starts without the per-system timing: app.renderer.monitor.sections().systems is false.
 * createApp({ pluginConfigs: { renderer: { mount: "#game", monitor: { budgetMs: "rate", frames: 1024, sections: { systems: false } } } } });
 * ```
 */
export type MonitorConfig = {
  /**
   * A frame over this is a spike. `"rate"` (the default): one frame of the rate the loop can reach,
   * the frame's own rate or the display's when that is slower — 8.33 ms at the 120 fps target on a
   * 120 Hz panel, 16.7 ms at the 60 fps fallback or on a 60 Hz panel — so a switch of the rate needs
   * no config change; a number is a fixed budget in ms.
   */
  budgetMs: number | "rate";
  /** Frames the ring keeps in an agent build, 64 to 16384; render passes keep 4x as many. */
  frames: number;
  /** `filter-still`: drawn frames a filtered view stands still, filtered in every one. Default 60. */
  stillFrames?: number;
  /** `filter-still`: megapixels its filter covers a frame, at least. Default 0.25. */
  stillMpx?: number;
  /** `target-churn`: render targets made and dropped a second that count as churn. Default 4. */
  churnPerSecond?: number;
  /** `target-churn`: seconds of churn in a row before the problem. Default 3. */
  churnSeconds?: number;
  /** `target-churn`: a render target made this many ms after a pool trim is churn at once. Default 1000. */
  churnAfterTrimMs?: number;
  /**
   * The sections of the monitor a debug build starts with (spec 11 R14): a section left out is on. `monitor.sections`
   * switches them later.
   */
  sections?: Partial<MonitorSections>;
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
export type {
  FilterCache,
  KeptInternal,
  KeptRange,
  KeptState,
  KeptStats,
  RetakeWhy,
  WhyLive
} from "./kept/types";
export type {
  FrameColumns,
  FrameReadout,
  FrameReadResult,
  FrameRecord,
  FrameRing,
  LongFrameEntry,
  MonitorSections,
  OverlayEventDetail,
  OverlayWhat,
  PassKind,
  PassRecord,
  PerfCause,
  PerfChange,
  PerfChangeEntry,
  PerfCollectorLine,
  PerfCounts,
  PerfDisplay,
  PerfEventLine,
  PerfEventName,
  PerfGapLine,
  PerfHeaderLine,
  PerfLogLine,
  PerfLongFrameLine,
  PerfMarkLine,
  PerfMeasured,
  PerfSampleLine,
  PerfSpikeLine,
  PerfStartupLine,
  PerfTelemetryLine,
  PerfThermalLine,
  PoolTrimDetail,
  ProblemEventDetail,
  ProblemRule,
  ShaderEventDetail,
  ShaderWhat,
  WarmDetail
} from "./monitor/log-types";
export type {
  Captured,
  CaptureOptions,
  CountingClasses,
  DrawCounter,
  LegendEntry,
  MonitorApi,
  MonitorCounts,
  MonitorDeps,
  MonitorInternal,
  MonitorState,
  PerfMonitorApi,
  PictureRect,
  RenderStats
} from "./monitor/types";
export type { CanvasRestart } from "./reasons";
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
  LeaveApi,
  LeaveCover,
  LeaveLoader,
  LeaveLook,
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
  ViewKind,
  WhyEntry
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
