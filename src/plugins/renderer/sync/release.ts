/**
 * @file renderer/sync — the decoded images of `textures.create` (F189). An `ImageBitmap` is kept open only until Pixi
 * has its source on the GPU of the drawing renderer, at a draw or through the upload queue: the step after the stage
 * pass closes it and gives the source a transparent 1x1 stand-in. Before that, a WebKit page held every texture twice:
 * an open bitmap is graphics memory of the page, `width × height × 4` bytes (208 MB for 30 images of the game, measured
 * in WebKit 26.4), next to the GPU copy; on an iPhone 16 Pro Max the page reached iOS's 2048 MB limit. The stand-in, never the closed bitmap, is what a later upload reads: WebGPU throws on
 * a closed bitmap, WebGL takes the 1x1 into a texture of the right size. A freed source cannot be uploaded again, so a
 * lost device with freed sources reloads the page (`loss.ts`). An `<img>` element, or a runtime without
 * `OffscreenCanvas`, keeps its image.
 */
import type { PixiTextureSource } from "../types";
import type { ReleaseState, SyncCtx, SyncState } from "./types";

/**
 * Tells whether a decoded image can be freed: an `ImageBitmap` has `close`, an `<img>` element has none.
 *
 * @param image - The decoded image.
 * @returns True for an image with `close`.
 */
function isClosable(image: unknown): image is ImageBitmap {
  return (
    typeof image === "object" &&
    image !== null &&
    "close" in image &&
    typeof image.close === "function"
  );
}

/**
 * The 1x1 transparent image every freed source holds, made once per renderer: a canvas with a 2d context, which both
 * `copyExternalImageToTexture` and `texSubImage2D` take.
 *
 * @param release - The release branch of the sync state.
 * @returns The stand-in.
 */
function standInOf(release: ReleaseState): OffscreenCanvas {
  if (release.standIn !== undefined) return release.standIn;

  const canvas = new OffscreenCanvas(1, 1);

  // A canvas with no context is no image source for every browser; one 2d context makes it a transparent pixel.
  canvas.getContext("2d");
  release.standIn = canvas;

  return canvas;
}

/**
 * Remembers a new source of `textures.create` whose decoded image can be freed: it waits for its upload. An image that
 * cannot be closed, or a runtime without `OffscreenCanvas`, keeps its image.
 *
 * @param state - The sync branch of the plugin state.
 * @param source - The source just made.
 */
export function holdImage(state: SyncState, source: PixiTextureSource): void {
  if (!isClosable(source.resource) || typeof OffscreenCanvas === "undefined") return;

  state.release.pending.push(source);
}

/**
 * Frees the decoded images Pixi has on the GPU now: each bitmap is closed and its source gets the stand-in. A source
 * not uploaded yet keeps waiting, and one destroyed meanwhile leaves the list. Runs after the stage pass of a drawn
 * frame; one compare while nothing waits, and no allocation while sources wait (the body of the sync module's
 * `releaseStep`).
 *
 * @param sctx - Domain context of the sync module.
 */
export function releaseStep(sctx: SyncCtx): void {
  const { release } = sctx.ctx.state.sync;
  const pending = release.pending;

  // per frame: nothing waits, one compare.
  if (pending.length === 0) return;

  let kept = 0;

  // Keep the sources Pixi has not uploaded yet, in place; free the others.
  for (let index = 0; index < pending.length; index += 1) {
    const source = pending[index];

    if (source === undefined || source.destroyed) continue;

    if (!sctx.deps.host.onGpu(source)) {
      pending[kept] = source;
      kept += 1;
      continue;
    }

    const image: unknown = source.resource;

    source.resource = standInOf(release);
    release.freed.add(source);
    if (isClosable(image)) image.close();
  }

  pending.length = kept;
}

/**
 * Frees the decoded image of a source that goes before its upload, at once instead of at the next collection, and
 * forgets a freed one. A freed source holds the stand-in and closes nothing.
 *
 * @param state - The sync branch of the plugin state.
 * @param source - The source of a texture being destroyed.
 */
export function dropImage(state: SyncState, source: PixiTextureSource): void {
  const { release } = state;

  // Freed already: only the count of freed sources changes.
  if (release.freed.delete(source)) return;

  const image: unknown = source.resource;

  if (isClosable(image)) image.close();
}
