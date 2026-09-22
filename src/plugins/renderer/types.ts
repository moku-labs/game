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
 * The five Pixi classes the renderer uses. The module object never arrives through a static
 * import: `config.loadPixi()` returns it, so a game without a screen carries no Pixi in its bundle.
 *
 * @example
 * ```ts
 * const pixi: PixiModule = await import("pixi.js");
 * pixi.Texture.WHITE.width; // 1
 * ```
 */
export type PixiModule = Pick<
  typeof import("pixi.js"),
  "Application" | "Container" | "Sprite" | "NineSliceSprite" | "Texture"
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
 * A Pixi texture. `assets` owns its lifetime; the renderer only makes and destroys it on request.
 */
export type PixiTexture = InstanceType<PixiModule["Texture"]>;

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
 * How this plugin sends its one event. The single emit site narrows the kernel's `emit` to it.
 *
 * @example
 * ```ts
 * const emit: EmitDeviceLost = (name, payload) => bus.send(name, payload);
 * emit("renderer:device-lost", { kind: "webgpu", reason: "destroyed" });
 * ```
 */
export type EmitDeviceLost = (
  name: "renderer:device-lost",
  payload: Events["renderer:device-lost"]
) => void;

/**
 * What the kernel context offers before the deps are attached.
 *
 * `emit` is declared as the kernel's own, unusable shape on purpose: core 1.7 leaves a plugin's
 * own event out of the context it hands the factories as soon as `depends` is declared, so a
 * renderer-typed `emit` here would make every factory unassignable. `host/device.ts` narrows this
 * one member to `EmitDeviceLost`; nothing else about the context is cast.
 */
export type KernelSlice = Omit<PluginCtx<Config, State, Events>, "emit"> & {
  emit(...args: never[]): void;
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
