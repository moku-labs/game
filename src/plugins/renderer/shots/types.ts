/**
 * @file renderer/shots — types of the shots module: the config a game declares, the two public members, what the frame
 * drives, and the state they share.
 */
import type {
  DemandModule,
  HostModule,
  PixiRenderTexture,
  SyncModule,
  ViewportModule
} from "../types";

/**
 * The shots of a game: small soft pictures of what stood on the screen, kept under asset keys. `undefined` by default,
 * and a game without it pays nothing: no pipeline is made and `take` does nothing. WebGPU only.
 *
 * @example
 * ```ts
 * // A loader that shows the place the player left, blurred, behind a ring.
 * const shots: ShotsConfig = { width: 96, height: 208, blur: 22 };
 * createApp({ pluginConfigs: { renderer: { mount: "#game", shots } } });
 * ```
 */
export type ShotsConfig = {
  /**
   * Texels across a shot, a whole number from 1 to 512. Anything else throws at `createApp`.
   *
   * @example
   * ```ts
   * // A soft backdrop needs few texels: a 96 x 208 shot holds 78 KiB on any screen.
   * createApp({ pluginConfigs: { renderer: { mount: "#game", shots: { width: 96, height: 208, blur: 22 } } } });
   * ```
   */
  width: number;
  /**
   * Texels down a shot, a whole number from 1 to 512. Anything else throws at `createApp`.
   *
   * @example
   * ```ts
   * // A landscape game keeps the shape of its frame: 208 x 96 for a 2340 x 1080 canvas.
   * createApp({ pluginConfigs: { renderer: { mount: "#game", shots: { width: 208, height: 96, blur: 22 } } } });
   * ```
   */
  height: number;
  /**
   * Sigma of the Gaussian in reference units of the frame's width, finite, 0 or more; 0 is no blur. It is the same
   * softness on every screen: each take converts it to `blur * width / viewport.size().width` texels, 10 at most.
   *
   * @example
   * ```ts
   * // On a 1080 u frame, 22 u is 1.96 texels of a 96 texel shot.
   * createApp({ pluginConfigs: { renderer: { mount: "#game", shots: { width: 96, height: 208, blur: 22 } } } });
   * // Only the reduction, no Gaussian: two passes fewer in a take.
   * createApp({ pluginConfigs: { renderer: { mount: "#game", shots: { width: 96, height: 208, blur: 0 } } } });
   * ```
   */
  blur: number;
  /**
   * Shots kept, a whole number of at least 1; 8 by default. At the limit a new key takes the texture of the oldest
   * taken, whose key stops answering: `has` says false, and a view that showed it draws the placeholder.
   *
   * @example
   * ```ts
   * // Two rooms in memory are enough for this game.
   * const shots: ShotsConfig = { width: 96, height: 208, blur: 22, keep: 2 };
   * app.renderer.shots.take("shot.hall"); // one drawn frame later, then the same for "shot.yard" and "shot.roof"
   * app.renderer.shots.has("shot.hall"); // false: the oldest went
   * app.renderer.shots.has("shot.roof"); // true
   * ```
   */
  keep?: number;
};

/**
 * The GPU objects of one device: the pipelines of the two filters and their one sampler. Not public.
 */
export type ShotPipes = {
  /** The box filter of a hop: 2 x 2 or 3 x 3 bilinear taps, its uniform says which. */
  box: GPURenderPipeline;
  /** One axis of the Gaussian: its weights live in a uniform, since they follow the frame's width. */
  blur: GPURenderPipeline;
  /** Linear, clamped at the edge. */
  sampler: GPUSampler;
};

/**
 * shots module state, `ctx.state.shots`.
 */
export type ShotsState = {
  /** Keys of the takes waiting for a drawn frame, each once. */
  wanted: string[];
  /** The shots, by key. Insertion order is age: a retake deletes and sets. */
  taken: Map<string, PixiRenderTexture>;
  /** The pipelines of the live device; `undefined` until they compiled, and after a loss. */
  pipes: ShotPipes | undefined;
  /** Removes the texture provider; `undefined` until `start` provided it. */
  off: (() => void) | undefined;
  /** A failed compile was logged: the next stays quiet. */
  warned: boolean;
};

/**
 * shots module API, `app.renderer.shots`: what a game calls to keep the frame it is about to leave, and to ask whether
 * it is there. A shot is the frame as drawn on the canvas, HUD included, reduced and blurred on the GPU. Its key
 * resolves like any asset key through the texture providers: `image`, `Sprite`. `leave.loader.texture` reads its key once, as the look shows, so it needs a shot that already stands.
 *
 * @example
 * ```ts
 * // At the start of the switch, in a live node.
 * app.renderer.shots.take("shot.panorama.bolt");
 * app.renderer.shots.has("shot.panorama.bolt"); // true once the next frame was drawn
 * ```
 */
export type ShotsApi = {
  /**
   * Keeps what the next drawn frame shows under `key`, replacing a shot of that key, and asks for that frame. The
   * look of `scenes.leave` is not in the shot: the frame draws without it, and the look shows from the next frame on
   * its own clock. Two keys taken before a frame is drawn get the same picture. Does nothing without `shots` in the
   * config, while the renderer does not draw, on WebGL, before the pipelines compiled, and while `world.ecs.mode()` is
   * not `"live"`: nothing is thrown and nothing is warned, so a game draws its baked picture then.
   *
   * @param key - The asset key the shot answers to.
   * @example
   * ```ts
   * // The player taps the door: the room is kept before the next scene takes the screen.
   * if (run.mode === "live") app.renderer.shots.take("shot.room.hall");
   * app.renderer.shots.has("shot.room.hall"); // false until the frame was drawn, true after it
   * ```
   */
  take(key: string): void;

  /**
   * Tells whether a shot stands under a key. False before its frame was drawn, after the oldest went for a newer one,
   * after a lost device, and on any renderer that takes none: a game draws its baked picture then.
   *
   * @param key - The asset key.
   * @returns True while the key answers a shot.
   * @example
   * ```ts
   * // The loader of the next switch shows the room when it stands, and the baked one when it does not.
   * const backdrop = app.renderer.shots.has("shot.room.hall") ? "shot.room.hall" : "ui.backdrop";
   * ```
   */
  has(key: string): boolean;
};

/**
 * What the plugin root and the frame drive. Not public.
 */
export type ShotsInternal = {
  /** From `host.onReady` and a rebuilt `host.onRestore`: provides the textures once, compiles the pipelines. */
  start(): void;
  /**
   * Right after the stage render, in the same task, while the canvas texture is valid. One length read with nothing
   * wanted; with keys wanted it empties them, and when `drawn` takes the shot and asks for one more frame.
   *
   * @param drawn - False for a frame of the heat map or one Pixi did not render: it takes nothing.
   */
  after(drawn: boolean): void;
  /** From `host.onLoss`: the takes, the shots and the pipelines go with the device, silently. */
  forget(): void;
};

/**
 * What `shots` gets injected: it runs after `sync` and is read by nobody else's module.
 */
export type ShotsDeps = {
  host: HostModule;
  viewport: ViewportModule;
  demand: DemandModule;
  sync: Pick<SyncModule, "textures">;
};
