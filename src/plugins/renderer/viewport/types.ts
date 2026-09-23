/**
 * @file renderer/viewport — type definitions: the map from the window to the reference space.
 */
import type { Config as GameConfig } from "../../../config";
import type { HostApi, HostInternal } from "../host/types";
import type { PixiContainer, RendererCtx } from "../types";

/**
 * The orientation a game is designed for, read from the framework config.
 *
 * @example
 * ```ts
 * const orientation: Orientation = "portrait";
 * ```
 */
export type Orientation = GameConfig["orientation"];

/**
 * A point in reference units.
 *
 * @example
 * ```ts
 * const point: Point = { x: 540, y: 960 };
 * ```
 */
export type Point = { x: number; y: number };

/**
 * A rectangle in CSS pixels inside the canvas.
 *
 * @example
 * ```ts
 * const frame: Rect = { x: 555, y: 0, width: 810, height: 1080 };
 * ```
 */
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * The part of the frame a notch, a home bar or a rounded corner covers, in reference units.
 *
 * @example
 * ```ts
 * const safeArea: SafeArea = { top: 47, right: 0, bottom: 34, left: 0 };
 * ```
 */
export type SafeArea = { top: number; right: number; bottom: number; left: number };

/**
 * What a game lays its board out in: the drawn frame in reference units.
 *
 * @example
 * ```ts
 * const size: ViewportSize = {
 *   width: 1080, height: 1920, scale: 0.5625, orientation: "portrait",
 *   safeArea: { top: 47, right: 0, bottom: 34, left: 0 }
 * };
 * ```
 */
export type ViewportSize = {
  width: number;
  height: number;
  scale: number;
  orientation: Orientation;
  safeArea: SafeArea;
};

/**
 * viewport module state.
 */
export type ViewportState = {
  /** The drawn rectangle inside the canvas, in CSS pixels. Bars fill the rest. */
  frame: Rect;
  /** CSS pixels per reference unit. */
  scale: number;
  /**
   * The frame in reference units: the short side is at least `referenceSide`, the long side inside
   * the safe area at least `referenceLong`.
   */
  reference: { width: number; height: number };
  safeArea: SafeArea;
  /** The observer saw a new size; the `render` callback applies it before drawing. */
  resizePending: boolean;
  /** The hidden element whose padding carries `env(safe-area-inset-*)`. */
  probe: HTMLElement | undefined;
  cleanups: Array<() => void>;
};

/**
 * viewport module API, `app.renderer.viewport`. The map between the window and the reference
 * space. Both sides fit: the short side holds `referenceSide`, the long side inside the safe area
 * holds `referenceLong`, and the smaller scale wins, so a wide screen gets a wider reference space.
 *
 * @example
 * ```ts
 * // A portrait game in a 1920x1080 window: an 810x1080 frame with bars left and right, and the
 * // 1920 reference long side decides the scale.
 * app.renderer.viewport.size(); // { width: 1440, height: 1920, scale: 0.5625, ... }
 * app.renderer.viewport.toReference(960, 540); // { x: 720, y: 960 }
 * ```
 */
export type ViewportApi = {
  /**
   * Maps a pointer event to reference units: `(client − canvas rect − frame offset) / scale`.
   * The canvas rectangle is read at call time, so a scrolled or animated page still answers right.
   *
   * @param clientX - `event.clientX` of a pointer event.
   * @param clientY - `event.clientY` of a pointer event.
   * @returns The point in reference units. Inert: the input unchanged.
   * @example
   * ```ts
   * // `input` turns every pointer event into reference units before it hit-tests.
   * const renderer = ctx.require(rendererPlugin);
   * const point = renderer.viewport.toReference(event.clientX, event.clientY);
   * renderer.sync.hitTest(point.x, point.y, isLiveDraggable);
   * ```
   */
  toReference(clientX: number, clientY: number): Point;

  /**
   * Maps a point in reference units to client CSS pixels, the coordinates of `event.clientX`:
   * `canvas rect + frame offset + point × scale`. The inverse of `toReference`; the canvas
   * rectangle is read at call time.
   *
   * @param point - A point in reference units.
   * @returns The point in client CSS pixels, a fresh object. Inert: the same numbers, reference
   *   units, since there is no canvas to place them on.
   * @example
   * ```ts
   * // The `game.rect` source of the editor places Home's Play plank on the page. A 390x844
   * // phone, the canvas at the top left: the scale is 390 / 1080.
   * const renderer = ctx.require(rendererPlugin);
   * renderer.viewport.toScreen({ x: 540, y: 960 }); // { x: 195, y: 346.666… }
   * ```
   */
  toScreen(point: Point): Point;

  /**
   * The drawn frame in reference units, as a fresh object.
   *
   * @returns Width, height, scale, designed orientation and the safe area.
   * @example
   * ```ts
   * // A board keeps its bottom row above the home bar of the phone.
   * const { height, safeArea } = app.renderer.viewport.size();
   * const bottom = height - safeArea.bottom; // 1920 - 34
   * ```
   */
  size(): ViewportSize;
};

/**
 * viewport methods injected into `sync` and driven by the plugin root. Not public.
 */
export type ViewportInternal = {
  /**
   * Writes the frame offset and the scale onto the root container, so root-local coordinates ARE
   * reference coordinates.
   *
   * @param root - The root container of `sync`.
   */
  apply(root: PixiContainer): void;

  /**
   * Creates the safe-area probe and the resize observer, and measures once.
   */
  start(): void;

  /**
   * Applies a pending resize: one per frame, before drawing.
   *
   * @returns True when the frame changed, so `sync` writes the root transform again.
   */
  applyPending(): boolean;
};

/**
 * What `viewport` gets injected: the module below it, both halves.
 */
export type ViewportDeps = { host: HostApi & HostInternal };

/**
 * Domain context of the viewport module.
 */
export type ViewportCtx = { ctx: RendererCtx; deps: ViewportDeps };
