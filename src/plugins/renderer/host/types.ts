/**
 * @file renderer/host — type definitions: the one Pixi application, its backend and its listeners.
 */
import type { PoolTrimDetail } from "../monitor/log-types";
import type {
  PixiApplication,
  PixiContainer,
  PixiMatrix,
  PixiModule,
  PixiRenderTexture,
  RendererKind
} from "../types";
import type { ResolutionReason } from "./resolution";

/**
 * Where the drawing resolution comes from (contract C-d): the device pixels, the cap, the render scale of the adaptive
 * frame rate, the switch that overrides them, and the change the next frame applies. Not public.
 */
export type ResolutionState = {
  /** The last `devicePixelRatio` seen; 1 without a window. */
  dpr: number;
  /** `maxResolution` of the config. */
  cap: number;
  /** Set by `monitor.setResolution`; `undefined` hands the choice back to `dpr`, `cap` and `scale`. */
  override: number | undefined;
  /** A change asked for and not applied yet: the next frame resizes with it. */
  pending: { value: number; reason: ResolutionReason } | undefined;
  /** The render scale the adaptive frame rate chose, a share of `min(dpr, cap)`; 1 at start. */
  scale: number;
  /** The lowest scale `adaptiveScale` allows on this device, read at init; 1 allows none. */
  floor: number;
};

/**
 * A listener of a resolution change: what Pixi drew at, what it draws at now, and why.
 */
export type ResolutionListener = (from: number, to: number, reason: ResolutionReason) => void;

/**
 * Why the pool is trimmed: a still screen, a scene change `restMs` ago, a pause. Not public.
 */
export type TrimReason = PoolTrimDetail["reason"];

/**
 * A listener of a pool trim: why, and the MiB it freed (rounded to two decimals). The monitor of an agent build
 * registers one to write the `pool-trim` event line.
 */
export type TrimListener = (reason: TrimReason, freedMb: number) => void;

/**
 * The pool trim of C14: when the screen last drew, the scene change no trim has followed yet, and the bytes of the
 * render targets right after the last trim. Not public.
 */
export type PoolState = {
  /** Clock ms of the last drawn frame; `undefined` before the first. */
  lastDrawnAt: number | undefined;
  /** Clock ms of a scene change no trim has followed yet. */
  sceneAt: number | undefined;
  /** A trim ran (or was judged not worth it) since the last drawn frame: one per rest. */
  restDone: boolean;
  /** Render-target bytes right after the last trim; 0 at start. Growth is measured from here. */
  baseline: number;
};

/**
 * The engine's own WebGPU adapter and device of an agent build, handed to Pixi as `webgpu.gpu`.
 */
export type OwnGpu = { adapter: GPUAdapter; device: GPUDevice };

/**
 * host module state.
 */
export type HostState = {
  /** The Pixi module object, once `config.loadPixi()` resolved. */
  pixi: PixiModule | undefined;
  app: PixiApplication | undefined;
  canvas: HTMLCanvasElement | undefined;
  /** Where the canvas was appended. Read by `viewport` for its observer and its measurements. */
  mount: HTMLElement | undefined;
  kind: RendererKind;
  ready: boolean;
  /** True from the moment a device is lost until the restore attempt ends. */
  restoring: boolean;
  /** `viewport` and `sync` subscribe here; run once, after the first successful init. */
  onReady: Array<() => void>;
  /**
   * Run after every successful restore, where `onReady` must not run twice: `rebuilt` is true when a new application
   * replaced the old one (WebGPU), false when a WebGL context came back on the same one.
   */
  onRestore: Array<(rebuilt: boolean) => void>;
  /** Run before the lost application is destroyed, while its display objects are still alive. */
  onLoss: Array<() => void>;
  cleanups: Array<() => void>;
  unsupported: HTMLElement | undefined;
  /**
   * Swaps Pixi's own classes back in. Set once per host state by the counting of a dev or debug
   * build, so a restore reuses the installed classes; `undefined` in a production build.
   */
  uninstallCounting: (() => void) | undefined;
  /**
   * Swaps Pixi's own encoder back in. Set once per host state by the pass counting of a production build (F8), so a
   * restore reuses the installed class; `undefined` in a dev or debug build, which counts with the six classes.
   */
  uninstallPasses: (() => void) | undefined;
  /**
   * Swaps Pixi's own bitmap text and batch pipes back in and drops the SDF batcher. Set once per host state when the
   * renderer's batched distance-field text went into Pixi's registry, so a restore reuses it; `undefined` while inert
   * and when the module lacked the pieces.
   */
  uninstallSdfText: (() => void) | undefined;
  /**
   * Swaps Pixi's own render-group pipe back in. Set once per host state when the renderer's pipe, which binds a
   * filter's input again after a cached group refreshed inside it (F10), went into Pixi's registry; `undefined` while
   * inert and when the module lacked the pieces.
   */
  uninstallRenderGroup: (() => void) | undefined;
  /**
   * Swaps Pixi's own WebGPU render target and pipeline systems back in. Set once per host state when the lazy canvas
   * pass (B3), which begins the canvas's pass at its first draw and keeps its stencil and depth only where something
   * reads them, went into Pixi's registry; `undefined` while inert and when the module lacked the pieces.
   */
  uninstallRenderPass: (() => void) | undefined;
  /** The drawing resolution: device pixels, cap, override and the pending change. */
  resolution: ResolutionState;
  /** Run after a frame applied a new resolution; emptied by `stopHost`. */
  onResolutionChange: ResolutionListener[];
  /** The engine's own adapter and device of an agent build on WebGPU; `undefined` otherwise. */
  ownGpu: OwnGpu | undefined;
  /** Texture sources the engine keeps as pictures (F12, C14): `textures()` counts them apart. */
  kept: WeakSet<object>;
  /** A pixel read of the oracle failed and was logged: the next failures stay quiet. */
  pixelsFailed: boolean;
  /** The pool trim of C14. */
  pool: PoolState;
  /** The trim listeners: the monitor's, in an agent build. Emptied by `stopHost`. */
  onTrim: TrimListener[];
};

/**
 * host module API, `app.renderer.host`. Everything a caller needs to know about the one Pixi
 * application: whether it draws, what it draws with, and which canvas it draws on.
 *
 * @example
 * ```ts
 * // A game shows a DOM fallback while the renderer is inert or on the unsupported screen.
 * if (!app.renderer.host.ready()) showFallback();
 * app.renderer.host.kind(); // "webgpu"
 * ```
 */
export type HostApi = {
  /**
   * Tells whether the renderer draws. False while inert, while the device is lost and on the
   * unsupported-device screen.
   *
   * @returns True after a successful init.
   * @example
   * ```ts
   * // `assets` skips the texture upload of a bundle while nothing can draw it.
   * const renderer = ctx.require(rendererPlugin);
   * if (!renderer.host.ready()) return; // headless: the bundle stays on disk
   * ```
   */
  ready(): boolean;

  /**
   * The backend Pixi chose, read once from the application after init.
   *
   * @returns `"webgpu"`, `"webgl"`, or `"none"` while inert or unsupported.
   * @example
   * ```ts
   * // A game notes that a browser without WebGPU draws on the WebGL fallback.
   * if (app.renderer.host.kind() === "webgl") showFallbackNote();
   * app.renderer.host.kind(); // "webgpu" in Chrome
   * ```
   */
  kind(): RendererKind;

  /**
   * The canvas of the Pixi application. A WebGPU restore makes a NEW canvas, so a caller that
   * holds listeners compares this with its stored canvas every frame.
   *
   * @returns The canvas, or `undefined` while inert and on the unsupported screen.
   * @example
   * ```ts
   * // `input` re-attaches its pointer listeners when a restore replaced the canvas.
   * const canvas = ctx.require(rendererPlugin).host.canvas();
   * if (canvas !== undefined && canvas !== attached) attachPointerListeners(canvas);
   * ```
   */
  canvas(): HTMLCanvasElement | undefined;

  /**
   * The Pixi module the renderer loaded lazily, so a plugin above draws with the same Pixi and
   * still imports none of it.
   *
   * @returns The module once `ready()`, `undefined` while inert, lost or unsupported.
   * @example
   * ```ts
   * // `text` builds the display object of a label out of the module the renderer loaded.
   * const pixi = ctx.require(rendererPlugin).host.pixi();
   * if (pixi === undefined) return; // headless: nothing is drawn
   *
   * const line = new pixi.BitmapText({ text: "+5", style: { fontFamily: "hud.body" } });
   * ```
   */
  pixi(): PixiModule | undefined;

  /**
   * The GPU device of the live WebGPU application, read at call time. A restore after a device
   * loss makes a new device, so a caller asks again instead of keeping it.
   *
   * @returns The device, or `undefined` while inert, before `ready()`, while the device is lost, on
   *   the unsupported screen and on the WebGL fallback.
   * @example
   * ```ts
   * // effects checks a custom filter's WGSL once in a dev build
   * const device = ctx.require(rendererPlugin).host.device();
   * const info = await device?.createShaderModule({ code: source }).getCompilationInfo();
   * info?.messages.filter(message => message.type === "error").length; // 0
   * ```
   */
  device(): GPUDevice | undefined;

  /**
   * The WebGL2 context of the live WebGL application, read at call time like `device()`. Pixi
   * restores a lost context itself, so a caller asks again instead of keeping it.
   *
   * @returns The context, or `undefined` while inert, before `ready()`, while the context is lost,
   *   on the unsupported screen and on WebGPU.
   * @example
   * ```ts
   * // effects compiles a custom filter's GLSL once in a dev build, on the WebGL fallback only
   * const gl = ctx.require(rendererPlugin).host.gl();
   * if (gl === undefined) return; // WebGPU, inert or a lost context: nothing to compile on
   * const shader = gl.createShader(gl.FRAGMENT_SHADER); // then shaderSource and compileShader
   * ```
   */
  gl(): WebGL2RenderingContext | undefined;

  /**
   * The resolution the application draws at now: device pixels per CSS pixel, capped by
   * `maxResolution` (or set by the debug switch). A change is applied in the frame after it was asked.
   *
   * @returns The resolution; 1 while inert.
   * @example
   * ```ts
   * // The settings sheet shows what the quality choice gives on this phone (devicePixelRatio 2.81).
   * app.renderer.host.resolution(); // 2 with maxResolution 2; 1.5 after the player picked "saver"
   * ```
   */
  resolution(): number;
};

/**
 * The textures the GPU holds: how many sources, their estimated bytes, and the bytes split into
 * art, render targets and kept pictures.
 *
 * @example
 * ```ts
 * const usage: TextureUsage = { count: 2, bytes: 5_242_880, art: 4_194_304, targets: 1_048_576, kept: 0 };
 * ```
 */
export type TextureUsage = {
  count: number;
  bytes: number;
  /** Bytes of the sources a game loaded: images, atlases. */
  art: number;
  /** Bytes of the render targets: filter textures, pictures Pixi renders into. */
  targets: number;
  /** Bytes of the sources the engine keeps as pictures. */
  kept: number;
};

/**
 * Swaps Pixi's six counting bases for counting subclasses and returns the undo. The plugin root
 * injects `installCounting` of `monitor/draw-calls.ts` here in a dev or debug build, already bound
 * to the sinks of `monitor`, because the classes must be in Pixi's registry before
 * `new Application()`, earlier than `monitor` exists.
 */
export type InstallCounting = (pixi: PixiModule) => () => void;

/**
 * What `host` gets injected: the counting of a dev or debug build, `undefined` in production, and the pass counting
 * every other build installs instead (F8).
 */
export type HostDeps = {
  installCounting: InstallCounting | undefined;
  installPasses: InstallCounting;
};

/**
 * host methods injected into `viewport`, `sync` and `monitor`, and driven by the plugin root. Not
 * public.
 */
export type HostInternal = {
  /**
   * Subscribes to the first successful init. Callbacks run in subscription order: `viewport`
   * first, `sync` second.
   *
   * @param fn - Called once, after `ready` turned true.
   */
  onReady(fn: () => void): void;

  /**
   * Subscribes to a successful restore, where the one-time registrations of `onReady` must not run
   * again. After a WebGPU restore a new application and a new canvas exist (`rebuilt` true); after
   * a WebGL restore the application and its tree are the same, and every render texture came back
   * empty (`rebuilt` false).
   *
   * @param fn - Called after every successful restore, told whether the application is new.
   */
  onRestore(fn: (rebuilt: boolean) => void): void;

  /**
   * Subscribes to the moment just before a lost application is destroyed. This is the last point
   * at which a display object the game owns can be saved out of the tree.
   *
   * @param fn - Called before every `destroy` of a lost application.
   */
  onLoss(fn: () => void): void;

  /**
   * The stage of the application. `sync` hangs its root container here.
   *
   * @returns The stage, or `undefined` while inert.
   */
  stage(): PixiContainer | undefined;

  /**
   * Where the canvas was appended. `viewport` observes and measures it.
   *
   * @returns The mount element, or `undefined` while inert.
   */
  mount(): HTMLElement | undefined;

  /**
   * Resizes the renderer to a CSS-pixel size, at the pending resolution when one was asked for;
   * the `onResolution` listeners hear the change. A no-op while nothing draws.
   *
   * @param width - New CSS width of the canvas.
   * @param height - New CSS height of the canvas.
   */
  resize(width: number, height: number): void;

  /**
   * Draws one frame. A no-op while nothing draws, so a lost device costs nothing.
   *
   * @returns True when it called Pixi.
   */
  render(): boolean;

  /**
   * Renders a container into an engine-owned texture before the stage pass, with Pixi's public
   * `renderer.render({ container, target, transform, clear })`: the kept pictures. Cleared to
   * premultiplied transparent. A no-op while nothing draws.
   *
   * @param container - The root of the render: a view's top, a stand-in, the stage root.
   * @param target - The texture.
   * @param transform - The world transform the root is drawn with in the texture.
   * @param clear - True to clear the texture first.
   * @returns True when it called Pixi.
   */
  renderTo(
    container: PixiContainer,
    target: PixiRenderTexture,
    transform: PixiMatrix,
    clear: boolean
  ): boolean;

  /**
   * Draws a probe tree of the warm-up with Pixi's public `renderer.render`: onto the canvas without clearing it
   * (`{ container, clear: false }`), or into the warm-up's own texture, cleared (`{ container, target, clear: true }`).
   * Called before the stage pass of a drawn frame, which clears the canvas first, so a probe never reaches the screen.
   * A no-op while nothing draws. What Pixi throws is thrown on: the caller counts the probe done and reports it.
   *
   * @param container - The root of the probe tree, never in the stage.
   * @param target - The texture of a texture variant; `undefined` for the canvas.
   * @returns True when it called Pixi.
   */
  renderProbe(container: PixiContainer, target?: PixiRenderTexture): boolean;

  /**
   * Tells whether the stage pass clears the canvas before it draws (`renderer.background.clearBeforeRender`, Pixi's
   * default, which the engine never turns off): only then may a probe draw onto the canvas.
   *
   * @returns True while the application clears the canvas at every stage pass; false while nothing draws.
   */
  clearsCanvas(): boolean;

  /**
   * Asks for a drawing resolution; the next frame applies it on the resize path. A burst of asks
   * costs one resize.
   *
   * @param value - Device pixels per CSS pixel.
   * @param reason - Why it changes.
   * @returns True when a change is now pending; false while nothing draws and when Pixi draws at
   *   it already.
   */
  setResolution(value: number, reason: ResolutionReason): boolean;

  /**
   * Sets or clears the switch that overrides device pixels and cap, and asks for the target.
   *
   * @param value - The resolution, or `undefined` to hand the choice back to them.
   * @returns The resolution the next frame draws at.
   */
  overrideResolution(value: number | undefined): number;

  /**
   * Tells whether a resolution change waits for the next frame.
   *
   * @returns True while one is pending.
   */
  resolutionPending(): boolean;

  /**
   * Subscribes to the resolution changes a frame applies.
   *
   * @param fn - Called with the old resolution, the new one and the reason.
   */
  onResolution(fn: ResolutionListener): void;

  /**
   * The engine's own WebGPU adapter of an agent build, while ready.
   *
   * @returns The adapter, or `undefined` without one.
   */
  adapter(): GPUAdapter | undefined;

  /**
   * Counts a texture source as a kept picture in `textures()`, or no longer.
   *
   * @param source - The source.
   * @param on - True to count it as kept.
   */
  keep(source: object, on: boolean): void;

  /**
   * Draws the stage into a PNG over the whole canvas. Every container in `hidden` is set
   * `visible = false` around the synchronous render inside Pixi's extract and set back right after
   * that call returns its promise, so no drawn frame sees it hidden. A failed read is logged.
   *
   * @param hidden - The layer containers to leave out of the picture; `[]` for the whole stage.
   * @returns A PNG data URL, or `undefined` while nothing draws or when Pixi could not read it.
   */
  extract(hidden: readonly PixiContainer[]): Promise<string | undefined>;

  /**
   * The texture sources the GPU holds and their estimated memory, read at call time, split into
   * art, render targets and kept pictures.
   *
   * @returns The usage; zero while nothing draws.
   */
  textures(): TextureUsage;

  /**
   * Draws the stage live into RGBA pixels over the whole canvas at half resolution, a quarter of
   * the pixels, for the pixel oracle of `debug.verifyFrames`; at another resolution when asked (the
   * kept pictures are compared at the renderer's, where their filters run as on the canvas). A
   * failed read is logged once.
   *
   * @param resolution - Device pixels per CSS pixel of the read; half by default.
   * @returns The pixels, or `undefined` while nothing draws or when Pixi could not read them.
   */
  pixels(resolution?: number): Uint8ClampedArray | undefined;

  /**
   * The rectangle of the canvas in CSS pixels, the stage's own space: what a view is measured
   * against to know whether it lands on the screen.
   *
   * @returns The rectangle, or `undefined` while nothing draws.
   */
  screen(): { x: number; y: number; width: number; height: number } | undefined;

  /**
   * Runs the init sequence: resolve the mount, load Pixi, create the application, append the
   * canvas, then run the `onReady` callbacks. A failure shows the unsupported-device screen.
   *
   * @returns Resolves when the application is up, or when the plugin decided to stay inert.
   */
  init(): Promise<void>;

  /**
   * The trim policy, once per frame after the frame closed (`host.render()` returned): a still screen of
   * `restMs` or a scene change `restMs` ago trims the pool when the render targets grew by `aboveMb` since the last
   * trim. Allocation-free on a frame where nothing is due; a no-op with `poolTrim: false` and while nothing draws.
   *
   * @param drawn - True when the frame was drawn.
   */
  afterFrame(drawn: boolean): void;

  /**
   * Notes a scene change: the policy trims `restMs` after it; a later change moves the moment.
   */
  sceneChanged(): void;

  /**
   * Gives back every idle render target of Pixi's pool now, with Pixi's public `TexturePool.clear(true)`: a texture
   * handed out and not returned survives and is destroyed when it comes back; a kept picture is never in the pool.
   * The new baseline is what the targets hold after it. Never call it inside a Pixi render call.
   *
   * @param reason - Why: a rest, a scene change, a pause.
   * @returns The bytes of the render targets it freed; 0 while nothing draws.
   */
  trimPool(reason: TrimReason): number;

  /**
   * Subscribes to the trims (the monitor of an agent build writes the `pool-trim` event line). The list is emptied by
   * `stopHost`.
   *
   * @param fn - Called after every trim with the reason and the MiB freed.
   */
  onTrim(fn: TrimListener): void;
};
