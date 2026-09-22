/**
 * @file renderer/host — type definitions: the one Pixi application, its backend and its listeners.
 */
import type { PixiApplication, PixiContainer, PixiModule, RendererKind } from "../types";

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
  /** Run after a restore created a new application, where `onReady` must not run twice. */
  onRestore: Array<() => void>;
  /** Run before the lost application is destroyed, while its display objects are still alive. */
  onLoss: Array<() => void>;
  cleanups: Array<() => void>;
  unsupported: HTMLElement | undefined;
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
   * // A game picks the WGSL or the GLSL source of its own filter.
   * const source = app.renderer.host.kind() === "webgpu" ? wgsl : glsl; // "webgpu" in Chrome
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
};

/**
 * host methods injected into `viewport` and `sync`, and driven by the plugin root. Not public.
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
   * Subscribes to a successful restore, where a new application and a new canvas exist but the
   * one-time registrations of `onReady` must not run again.
   *
   * @param fn - Called after every successful restore.
   */
  onRestore(fn: () => void): void;

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
   * Resizes the renderer to a CSS-pixel size. A no-op while nothing draws.
   *
   * @param width - New CSS width of the canvas.
   * @param height - New CSS height of the canvas.
   */
  resize(width: number, height: number): void;

  /**
   * Draws one frame. A no-op while nothing draws, so a lost device costs nothing.
   */
  render(): void;

  /**
   * Runs the init sequence: resolve the mount, load Pixi, create the application, append the
   * canvas, then run the `onReady` callbacks. A failure shows the unsupported-device screen.
   *
   * @returns Resolves when the application is up, or when the plugin decided to stay inert.
   */
  init(): Promise<void>;
};
