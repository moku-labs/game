/**
 * @file renderer/monitor — type definitions: what the renderer tells a tool about its frames.
 */
import type { HostApi, HostInternal } from "../host/types";
import type { SyncApi, SyncInternal } from "../sync/types";
import type { PixiModule } from "../types";

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
 * wait for a frame.
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
  /** Callers of `capture()` waiting for the next drawn frame. */
  captures: Array<(url: string | undefined) => void>;
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
   * @returns A `data:image/png;base64,…` URL. `undefined` in a production build, while inert, lost
   *   or unsupported, and when Pixi could not read the frame (logged with `ctx.log.error`).
   * @example
   * ```ts
   * // The editor's capture button, on the dev page that set globalThis.__MOKU_GAME_DEV__ = true.
   * const url = await app.renderer.capture(); // "data:image/png;base64,iVBORw0KGgo…"
   * // The same call in a production build.
   * await app.renderer.capture(); // undefined
   * ```
   */
  capture(): Promise<string | undefined>;
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
 * What `monitor` gets injected: the modules it reads its counters from.
 */
export type MonitorDeps = { host: HostApi & HostInternal; sync: SyncApi & SyncInternal };
