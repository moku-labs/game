/**
 * @file renderer/shots — the state of the shots, the texture of a shot, and what a loss and a stop leave.
 */
import { destroyWhole } from "../sources";
import type { PixiModule, PixiRenderTexture } from "../types";
import { SHOT_FORMAT } from "./shader";
import type { ShotsConfig, ShotsDeps, ShotsState } from "./types";

/**
 * Creates an empty key list. It lives in its own non-exported function because lint rule L5 refuses a collection built
 * inside an exported declaration.
 *
 * @returns An empty list.
 */
function emptyKeys(): string[] {
  return [];
}

/**
 * Creates an empty map. Same reason as `emptyKeys`.
 *
 * @returns An empty map.
 */
function emptyShots(): Map<string, PixiRenderTexture> {
  return new Map();
}

/**
 * Makes the empty state of the shots.
 *
 * @returns The shots branch of the plugin state.
 */
export function createShotsState(): ShotsState {
  return {
    wanted: emptyKeys(),
    taken: emptyShots(),
    pipes: undefined,
    off: undefined,
    warned: false
  };
}

/**
 * Makes the texture of a shot, on the GPU at once: linear and clamped, so a stretched shot stays soft to its edges, of
 * the format the pipelines draw, and Pixi's collector leaves it alone. Its own texture, no atlas, no mipmaps.
 *
 * @param pixi - The module that draws.
 * @param host - What registers and uploads it.
 * @param shots - The config.
 * @returns The texture.
 */
export function createShotTexture(
  pixi: Pick<PixiModule, "RenderTexture">,
  host: Pick<ShotsDeps["host"], "keep" | "initSource">,
  shots: Readonly<ShotsConfig>
): PixiRenderTexture {
  const texture = pixi.RenderTexture.create({
    width: shots.width,
    height: shots.height,
    resolution: 1,
    scaleMode: "linear",
    addressMode: "clamp-to-edge",
    autoGarbageCollect: false,
    format: SHOT_FORMAT,
    label: "renderer.shot"
  });

  host.keep(texture.source, true);
  host.initSource(texture.source);

  return texture;
}

/**
 * Forgets what a device held: the takes, the shots and the pipelines. The textures went with the device.
 *
 * @param state - The shots branch of the plugin state.
 */
export function forgetShots(state: ShotsState): void {
  state.wanted.length = 0;
  state.taken.clear();
  state.pipes = undefined;
}

/**
 * Removes the texture provider and destroys every shot while the application exists (`stopRenderer` runs it before
 * `stopHost`).
 *
 * @param state - The shots branch of the plugin state.
 */
export function stopShots(state: ShotsState): void {
  state.off?.();
  state.off = undefined;

  for (const texture of state.taken.values()) destroyWhole(texture);

  forgetShots(state);
}
