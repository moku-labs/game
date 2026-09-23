/**
 * @file renderer/monitor — type definitions: what the renderer tells a tool about its frames.
 */
import type { HostApi, HostInternal } from "../host/types";
import type { SyncApi, SyncInternal } from "../sync/types";

/**
 * The counters of the renderer, for a stats panel or a frame-budget check. Plain numbers, so the
 * object goes through `JSON.stringify` as it is.
 *
 * @example
 * ```ts
 * const stats: RenderStats = { fps: 60, frameMs: 3.4, textures: 12, textureMb: 41.25, views: 180, pooled: 24 };
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
  /** Texture sources on the GPU: Pixi's `renderer.texture.managedTextures`. */
  textures: number;
  /** Estimated GPU memory of those sources in MiB: 4 bytes per pixel, every mip level. */
  textureMb: number;
  /** Display objects `sync` holds for entities. */
  views: number;
  /** Display objects waiting in the pools. */
  pooled: number;
  /**
   * Not counted, so always absent. Under WebGPU, Pixi 8.21 batches sprites and graphics straight
   * onto the native render pass encoder (`encoder.renderPassEncoder.drawIndexed`), past
   * `renderer.encoder.draw`, so no one place in Pixi sees every draw.
   */
  drawCalls?: number;
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
};

/**
 * monitor module API, on `app.renderer` itself: the counters of the renderer and, in a dev build,
 * a picture of the frame. What the editor's `game.render` source and `game.capture` command read.
 *
 * @example
 * ```ts
 * // A headless test: nothing is drawn, so every counter is 0 and there is no picture.
 * app.renderer.stats(); // { fps: 0, frameMs: 0, textures: 0, textureMb: 0, views: 0, pooled: 0 }
 * await app.renderer.capture(); // undefined
 * ```
 */
export type MonitorApi = {
  /**
   * The counters of the renderer, as a fresh object. The frame timing is kept each frame without
   * an allocation; the rest is read at call time from `sync` and Pixi. There is no `drawCalls`:
   * Pixi 8.21 has no one draw point under WebGPU.
   *
   * @returns Frames per second, frame work, GPU textures and their memory, views, pooled objects.
   *   Inert: all 0.
   * @example
   * ```ts
   * // The editor's stats panel reads it every frame. Here the game drew one sprite for 51 frames,
   * // 20 ms apart with 4 ms of work each, and its texture is not uploaded yet.
   * app.renderer.stats(); // { fps: 50, frameMs: 4, textures: 0, textureMb: 0, views: 1, pooled: 0 }
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
   * Marks the start of a frame: closes an interval of the measuring window.
   */
  begin(): void;

  /**
   * Marks the end of a drawn frame: adds its work to the window, and hands the frame to the
   * captures that wait for it.
   */
  end(): void;
};

/**
 * What `monitor` gets injected: the modules it reads its counters from.
 */
export type MonitorDeps = { host: HostApi & HostInternal; sync: SyncApi & SyncInternal };
