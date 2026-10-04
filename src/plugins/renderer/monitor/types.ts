/**
 * @file renderer/monitor — type definitions: what the renderer tells a tool about its frames.
 */
import type { HostApi, HostInternal } from "../host/types";
import type { SyncApi, SyncInternal } from "../sync/types";
import type { PixiModule, RendererCtx } from "../types";
import type { ViewportApi, ViewportInternal } from "../viewport/types";

/**
 * The counters of the renderer, for a stats panel or a frame-budget check. Plain numbers, so the
 * object goes through `JSON.stringify` as it is.
 *
 * @example
 * ```ts
 * // The board of Timber Town in a dev build: one glowing button on screen.
 * const stats: RenderStats = {
 *   fps: 60, frameMs: 3.4, textures: 12, textureMb: 41.25, views: 180, pooled: 24,
 *   renderPasses: 3, drawCalls: 14
 * };
 * ```
 */
export type RenderStats = {
  /**
   * Frames drawn per second, measured over the last full second of `clock` time. 0 before the
   * first second, while inert, and when no frame was drawn in the last second (a paused clock).
   */
  fps: number;
  /**
   * Mean milliseconds of `clock` time one frame took over that second, CPU side: from the
   * renderer's callback in phase `input` to the end of `render`.
   */
  frameMs: number;
  /** Live texture sources on the GPU: Pixi's `renderer.texture.managedTextures`, empty slots skipped. */
  textures: number;
  /** Estimated GPU memory of those sources in MiB: 4 bytes per pixel, every mip level. */
  textureMb: number;
  /** Display objects `sync` holds for entities. */
  views: number;
  /** Display objects waiting in the pools. */
  pooled: number;
  /**
   * Render passes of a frame, computed from the filter slots `sync` holds: 1 for the frame, and
   * for every view in the tree with an enabled filter 1 for its content plus the passes of its
   * enabled slots. 0 while inert. What filters cost on a phone.
   */
  renderPasses: number;
  /**
   * Draw calls of the last drawn frame. Dev builds only, counted on WebGPU: absent in a production
   * build, 0 while inert and on the WebGL fallback.
   */
  drawCalls?: number;
};

/**
 * The draw-call counter of a dev build: the draws of the frame being drawn and of the last one.
 * The counting classes close over this one object, so its identity never changes.
 */
export type DrawCounter = { frame: number; last: number };

/**
 * The three counting subclasses, built from the Pixi module at run time.
 */
export type CountingClasses = {
  batch: PixiModule["GpuBatchAdaptor"];
  graphics: PixiModule["GpuGraphicsAdaptor"];
  encoder: PixiModule["GpuEncoderSystem"];
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
  /** Mean frame work of the last closed window, in milliseconds. */
  frameMs: number;
  /** Captures waiting for a drawn frame, served in `end()`. */
  captures: PictureRequest[];
  /** The draws the dev counter saw; stays at 0 in a production build. */
  draws: DrawCounter;
};

/**
 * monitor module API, on `app.renderer` itself: the counters of the renderer and, in a dev build,
 * a picture of the frame. What the editor's `game.render` source and `game.capture` command read.
 *
 * @example
 * ```ts
 * // A headless test: nothing is drawn, so every counter is 0 and there is no picture.
 * app.renderer.stats(); // { fps: 0, frameMs: 0, textures: 0, textureMb: 0, views: 0, pooled: 0, renderPasses: 0 }
 * await app.renderer.capture(); // undefined
 * ```
 */
export type MonitorApi = {
  /**
   * The counters of the renderer, as a fresh object. The frame timing and the draw calls are kept
   * each frame without an allocation; the rest is read at call time from `sync` and Pixi.
   * `drawCalls` is there in a dev build only.
   *
   * @returns Frames per second, frame work, GPU textures and their memory, views, pooled objects,
   *   render passes, and in a dev build the draw calls of the last frame. Inert: all 0.
   * @example
   * ```ts
   * // The editor's stats panel reads it every frame. Here the game drew one sprite for 51 frames,
   * // 20 ms apart with 4 ms of work each, and its texture is not uploaded yet.
   * app.renderer.stats(); // { fps: 50, frameMs: 4, textures: 0, textureMb: 0, views: 1, pooled: 0, renderPasses: 1 }
   * // The same frame in a dev build also counts the one sprite batch: { ..., drawCalls: 1 }
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
 * monitor methods the frame drives. Not public.
 */
export type MonitorInternal = {
  /**
   * Marks the start of a frame: closes an interval of the measuring window and starts the draw
   * count of the frame at 0.
   */
  begin(): void;

  /**
   * Marks the end of a drawn frame: adds its work to the window, closes the draw count, and hands
   * the frame to the captures that wait for it.
   */
  end(): void;
};

/**
 * What `monitor` gets injected: the modules it reads its counters from and places a legend with.
 */
export type MonitorDeps = {
  host: HostApi & HostInternal;
  viewport: ViewportApi & ViewportInternal;
  sync: SyncApi & SyncInternal;
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
