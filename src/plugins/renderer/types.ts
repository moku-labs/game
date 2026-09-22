/**
 * @file renderer plugin — shared types of the plugin and its three modules.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Config as GameConfig, Require } from "../../config";
import type { Api as LifecycleApi } from "../lifecycle/types";
import type { Api as TimeApi } from "../time/types";
import type { Api as WorldApi } from "../world/types";
import type { HostApi, HostInternal, HostState } from "./host/types";
import type { SyncApi, SyncInternal, SyncState } from "./sync/types";
import type { ViewportApi, ViewportInternal, ViewportState } from "./viewport/types";

/**
 * The part of Pixi the engine uses: the classes `sync` builds views from, the bitmap-font pieces
 * `fonts.install` needs, and the `BitmapText` a plugin above builds through `host.pixi()`. The
 * module object never arrives through a static import: `config.loadPixi()` returns it, so a game
 * without a screen carries no Pixi in its bundle.
 *
 * @example
 * ```ts
 * const pixi: PixiModule = await import("pixi.js");
 * pixi.Texture.WHITE.width; // 1
 * ```
 */
export type PixiModule = Pick<
  typeof import("pixi.js"),
  | "Application"
  | "BitmapFont"
  | "BitmapText"
  | "Cache"
  | "Container"
  | "Graphics"
  | "NineSliceSprite"
  | "Sprite"
  | "Texture"
  | "bitmapFontTextParser"
  | "bitmapFontXMLStringParser"
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
 * renderer plugin config.
 *
 * @example
 * ```ts
 * createApp({
 *   plugins: [...screen],
 *   pluginConfigs: { renderer: { mount: "#game", background: 0x101018, maxResolution: 2 } }
 * });
 * ```
 */
export type Config = {
  /** Where the canvas goes: a selector or an element. `undefined` keeps the plugin inert. */
  mount: string | HTMLElement | undefined;
  /** Clear colour. Also the colour of the bars around the frame. */
  background: number;
  /** Antialias the whole canvas. Off by default: pixel art and sprites do not need it. */
  antialias: boolean;
  /** Cap of `devicePixelRatio`. Memory grows with its square. */
  maxResolution: number;
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
};

/**
 * renderer plugin state: one branch per module.
 */
export type State = { host: HostState; viewport: ViewportState; sync: SyncState };

/**
 * renderer plugin API, `app.renderer`, grouped by module.
 *
 * @example
 * ```ts
 * app.renderer.host.kind(); // "webgpu"
 * app.renderer.viewport.size().width; // 1080, reference units
 * app.renderer.sync.hitTest(540, 300, () => true); // 1048576
 * ```
 */
export type Api = { host: HostApi; viewport: ViewportApi; sync: SyncApi };

/**
 * Resolved dependency APIs.
 */
export type Deps = { time: TimeApi; lifecycle: LifecycleApi; world: WorldApi };

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
 * The three modules in injection order.
 */
export type Modules = { host: HostModule; viewport: ViewportModule; sync: SyncModule };

/**
 * What `onStop` receives: the frozen config and the plugin state, nothing else.
 */
export type TeardownScope = { readonly config: Readonly<Config>; readonly state: State };

export type { HostApi, HostInternal, HostState } from "./host/types";
export type {
  CreateTextureOptions,
  DisplayAdapter,
  DisplayEntry,
  DisplaysApi,
  FontsApi,
  HitBox,
  LayerEntry,
  NineBorders,
  SyncApi,
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
