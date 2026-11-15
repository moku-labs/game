/**
 * @file renderer/sync — the decoded images of `textures.create` (F189). An `ImageBitmap` handed over with a `reload`
 * is kept open only until Pixi has its source on the GPU of the drawing renderer, at a draw or through the upload
 * queue: the step after the stage pass closes it and gives the source a transparent 1x1 stand-in. Before that, a
 * WebKit page held every texture twice, the decoded bitmap and the GPU copy: on an iPhone 16 Pro Max the bitmaps were
 * ~440 MB of a 1671 MB footprint, and iOS ended the page at 2048 MB. The stand-in, never the closed bitmap, is what a
 * later upload reads: WebGPU throws on a closed bitmap, WebGL takes the 1x1 into a texture of the right size. A lost
 * device comes back through `refill`: every freed source is decoded again from its file before the renderer draws,
 * then freed again after its upload. Without a reload, or without `OffscreenCanvas`, the bitmap stays open, as before.
 */
import type { PixiTextureSource } from "../types";
import type { ReleaseState, SyncCtx, SyncState, TextureReload } from "./types";

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
    typeof (image as { close?: unknown }).close === "function"
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
 * Remembers a new source of `textures.create` whose decoded image may be freed: it waits for its upload. A source
 * with no reload, an image that cannot be closed, or a runtime without `OffscreenCanvas` keeps its image.
 *
 * @param state - The sync branch of the plugin state.
 * @param source - The source just made.
 * @param reload - Decodes its image again from the file; `undefined` keeps the image.
 */
export function holdImage(
  state: SyncState,
  source: PixiTextureSource,
  reload: TextureReload | undefined
): void {
  if (reload === undefined || !isClosable(source.resource)) return;
  if (typeof OffscreenCanvas === "undefined") return;

  state.release.reloads.set(source, reload);
  state.release.pending.push(source);
}

/**
 * Frees the decoded images Pixi has on the GPU now: each bitmap is closed and its source gets the stand-in. A source
 * not uploaded yet keeps waiting, and one destroyed meanwhile leaves the list. Runs after the stage pass of a drawn
 * frame; one compare and no allocation while nothing waits, no allocation while sources wait (the body of
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
    if (isClosable(image)) image.close();
  }

  pending.length = kept;
}

/**
 * Frees the decoded image of a source that goes before its upload, at once instead of at the next collection, and
 * forgets its reload. A source already freed holds the stand-in and closes nothing.
 *
 * @param state - The sync branch of the plugin state.
 * @param source - The source of a texture being destroyed.
 */
export function dropImage(state: SyncState, source: PixiTextureSource): void {
  const { release } = state;

  if (!release.reloads.delete(source)) return;

  const image: unknown = source.resource;

  if (image !== release.standIn && isClosable(image)) image.close();
}

/**
 * Fills one freed source again from its file and lets it wait for its next upload. A source destroyed while its file
 * was read closes the new image; a file that fails is logged and the source stays transparent.
 *
 * @param sctx - Domain context of the sync module.
 * @param source - A source that holds the stand-in.
 * @param reload - Decodes its image again.
 */
async function fillOne(
  sctx: SyncCtx,
  source: PixiTextureSource,
  reload: TextureReload
): Promise<void> {
  const { release } = sctx.ctx.state.sync;

  try {
    const image = await reload();

    if (source.destroyed || !release.reloads.has(source)) {
      if (isClosable(image)) image.close();

      return;
    }

    source.resource = image;
    // The same size as the first image: Pixi uploads it again where the source is on a GPU already.
    source.update();
    if (isClosable(image)) release.pending.push(source);
  } catch (error) {
    sctx.ctx.log.warn("renderer:reload-failed", { source: source.label, error });
  }
}

/**
 * Starts the fill of every source that holds the stand-in.
 *
 * @param sctx - Domain context of the sync module.
 * @returns One promise per freed source.
 */
function startFills(sctx: SyncCtx): Array<Promise<void>> {
  const { release } = sctx.ctx.state.sync;
  const fills: Array<Promise<void>> = [];

  for (const [source, reload] of release.reloads) {
    if (source.resource === release.standIn) fills.push(fillOne(sctx, source, reload));
  }

  return fills;
}

/**
 * Fills every freed source again from its file, after a lost device and before the restored renderer draws (the
 * body of `refill`). Nothing is read when no source was freed.
 *
 * @param sctx - Domain context of the sync module.
 * @returns Resolves when every reload settled; `undefined` when there is nothing to fill.
 */
export function refillImages(sctx: SyncCtx): Promise<void> | undefined {
  if (sctx.ctx.state.sync.release.standIn === undefined) return undefined;

  const fills = startFills(sctx);

  if (fills.length === 0) return undefined;

  return settleAll(fills);
}

/**
 * Waits for every fill. Each one catches its own error, so this never rejects.
 *
 * @param fills - The running fills.
 */
async function settleAll(fills: ReadonlyArray<Promise<void>>): Promise<void> {
  await Promise.all(fills);
}
