/**
 * @file renderer/host — what a tool reads back from the one application: a PNG of the stage over
 * the whole canvas, some layers left out on request, and the textures the GPU holds with an
 * estimate of their memory by kind, and the idle share waiting in Pixi's pool (F236).
 */
import type {
  PixiApplication,
  PixiContainer,
  PixiModule,
  PixiTexture,
  RendererCtx
} from "../types";
import type { SourceKind, SourceKinds, TextureUsage } from "./types";

/** Bytes of one pixel: the engine loads PNG and WebP only, so every source is 8-bit RGBA. */
const BYTES_PER_PIXEL = 4;

/**
 * Estimates the GPU bytes of one texture source: 4 bytes per pixel, every mip level, a level never
 * smaller than one pixel.
 *
 * @param source - The size fields of a Pixi `TextureSource`.
 * @param source.pixelWidth - Width in real pixels.
 * @param source.pixelHeight - Height in real pixels.
 * @param source.mipLevelCount - Mip levels, 1 without mipmaps.
 * @returns The estimated bytes.
 * @example
 * ```ts
 * sourceBytes({ pixelWidth: 4, pixelHeight: 4, mipLevelCount: 3 }); // 84: 16 + 4 + 1 pixels
 * ```
 */
export function sourceBytes(source: {
  pixelWidth: number;
  pixelHeight: number;
  mipLevelCount: number;
}): number {
  let pixels = 0;
  let width = source.pixelWidth;
  let height = source.pixelHeight;

  for (let level = 0; level < Math.max(1, source.mipLevelCount); level += 1) {
    pixels += width * height;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }

  return pixels * BYTES_PER_PIXEL;
}

/**
 * Tells a render target from art: Pixi gives a target no upload method and no resource.
 *
 * @param source - The upload fields of a Pixi `TextureSource`.
 * @param source.uploadMethodId - How Pixi uploads it; `"unknown"` for a render target.
 * @param source.resource - What it uploads; none for a render target.
 * @returns True for a render target.
 * @example
 * ```ts
 * isTarget({ uploadMethodId: "unknown", resource: null }); // true
 * ```
 */
function isTarget(source: { uploadMethodId: string; resource: unknown }): boolean {
  return (
    source.uploadMethodId === "unknown" &&
    (source.resource === null || source.resource === undefined)
  );
}

/**
 * The one usage the walk writes into: `textureUsage` runs at every `stats()` call, so it makes no object. Every call
 * writes over it.
 */
const usage: TextureUsage = {
  count: 0,
  bytes: 0,
  art: 0,
  text: 0,
  targets: 0,
  kept: 0,
  other: 0,
  idleTargets: 0,
  idleKept: 0
};

/**
 * Counts the texture sources the GPU holds and sums their estimated bytes, split five ways, the first that fits: a
 * source the engine keeps as a picture is kept (and idle too while it waits in the kept pool); one with no upload
 * method and no resource is a render target (a filter texture, a picture Pixi renders into); one `sync` marked is text
 * or art; every other source is other. Pixi's `managedTextures` exists on the WebGPU and the WebGL texture system
 * alike (checked in 8.22); Pixi's canvas renderer keeps no GPU texture and answers zero. Both systems answer
 * `Object.values` of a `GCManagedHash`, which keeps a `null` slot for every unloaded source, so only the live sources
 * are counted. One indexed walk that makes nothing: the answer is the same object every call, `idleTargets` 0 (only
 * `host.textures()` reads Pixi's pool).
 *
 * @param app - The application that draws.
 * @param kinds - The kept sources, the marks of `sync` and the idle kept sources: the host state.
 * @returns The count, the bytes and their split, written over by the next call.
 */
export function textureUsage(app: PixiApplication, kinds: SourceKinds): TextureUsage {
  const system = app.renderer.texture;

  usage.count = 0;
  usage.bytes = 0;
  usage.art = 0;
  usage.text = 0;
  usage.targets = 0;
  usage.kept = 0;
  usage.other = 0;
  usage.idleTargets = 0;
  usage.idleKept = 0;

  if (!("managedTextures" in system)) return usage;

  const sources = system.managedTextures;
  const total = sources.length;

  for (let index = 0; index < total; index += 1) {
    // Pixi's type says `TextureSource[]`, but an unloaded source leaves `null` in the list.
    const source = sources[index];

    if (!source) continue;

    const bytes = sourceBytes(source);

    usage.count += 1;
    usage.bytes += bytes;

    if (kinds.kept.has(source)) {
      usage.kept += bytes;
      if (kinds.idle.has(source)) usage.idleKept += bytes;
    } else if (isTarget(source)) usage.targets += bytes;
    else addMarked(kinds.marks.get(source), bytes);
  }

  return usage;
}

/**
 * Adds the bytes of a source that is neither kept nor a target to its kind: text, art, or other without a mark.
 *
 * @param kind - The mark `sync` gave it, or `undefined`.
 * @param bytes - Its bytes.
 */
function addMarked(kind: SourceKind | undefined, bytes: number): void {
  if (kind === "text") usage.text += bytes;
  else if (kind === "art") usage.art += bytes;
  else usage.other += bytes;
}

/** The idle textures of Pixi's pool by bucket: a private field Pixi 8 keeps, read here and by the trim (F187). */
export type PoolBuckets = { _buckets?: Map<number, PixiTexture[]> };

/**
 * The scratch of the bucket walk: the kept sources it skips, set for the length of one `idleTargetBytes` call, and the
 * bytes it summed so far. One walk at a time, nothing of it leaves.
 */
const walk: { kept: WeakSet<object> | undefined; bytes: number } = { kept: undefined, bytes: 0 };

/**
 * The bytes of one texture that waits for reuse: a live source the engine does not keep.
 *
 * @param texture - An idle texture.
 * @param kept - The sources the engine keeps as pictures.
 * @returns Its bytes, or 0.
 */
function idleBytes(texture: PixiTexture | undefined, kept: WeakSet<object>): number {
  if (texture === undefined) return 0;

  const { source } = texture;

  return source.destroyed || kept.has(source) ? 0 : sourceBytes(source);
}

/**
 * Adds the idle textures of one bucket of Pixi's pool to the walk: the callback `Map.prototype.forEach` takes, made
 * once at module level, so the walk makes no function and no iterator.
 *
 * @param textures - The idle textures of one bucket.
 */
function addBucket(textures: readonly PixiTexture[]): void {
  const { kept } = walk;

  if (kept === undefined) return;

  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < textures.length; index += 1) {
    walk.bytes += idleBytes(textures[index], kept);
  }
}

/**
 * The bytes of the render targets waiting for reuse: the idle textures of Pixi's `TexturePool` and the targets the
 * trim holds until their bind groups let go (`pool.held`). A texture counts when its source is not destroyed and not
 * kept. Reads the private buckets of Pixi 8, as the trim does; without them it answers 0. Makes nothing: one
 * `forEach` with a module-level callback, indexed walks inside.
 *
 * @param pixi - The module the renderer loaded.
 * @param held - The targets the trim holds.
 * @param kept - The sources the engine keeps as pictures.
 * @returns The bytes.
 */
export function idleTargetBytes(
  pixi: PixiModule,
  held: readonly PixiTexture[],
  kept: WeakSet<object>
): number {
  const buckets = (pixi.TexturePool as unknown as PoolBuckets)._buckets;

  if (!(buckets instanceof Map)) return 0;

  walk.kept = kept;
  walk.bytes = 0;
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a module-level callback
  buckets.forEach(addBucket);

  let bytes = walk.bytes;

  walk.kept = undefined;
  walk.bytes = 0;

  for (let index = 0; index < held.length; index += 1) bytes += idleBytes(held[index], kept);

  return bytes;
}

/**
 * Hides containers for the length of one synchronous call and shows them again right after it,
 * also when it throws. A container hidden already stays hidden.
 *
 * @param hidden - The containers to hide.
 * @param work - The call; it runs with them hidden.
 * @returns What the call returned.
 */
function withHidden<T>(hidden: readonly PixiContainer[], work: () => T): T {
  const shown = hidden.filter(container => container.visible);

  for (const container of shown) container.visible = false;

  try {
    return work();
  } finally {
    for (const container of shown) container.visible = true;
  }
}

/**
 * Draws the stage into a PNG over the whole canvas, bars included, with Pixi's extract system.
 * Pixi renders the stage synchronously inside the call and encodes afterwards, so the containers
 * in `hidden` are hidden around the call alone: no drawn frame sees them hidden. A failed read is
 * logged and answers `undefined`, so a caller never has to catch.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param app - The application that draws.
 * @param hidden - The layer containers to leave out of the picture.
 * @returns A `data:image/png;base64,…` URL, or `undefined` when Pixi could not read the frame.
 */
export async function extractStage(
  ctx: RendererCtx,
  app: PixiApplication,
  hidden: readonly PixiContainer[]
): Promise<string | undefined> {
  try {
    return await withHidden(hidden, () =>
      app.renderer.extract.base64({
        target: app.stage,
        frame: app.screen,
        clearColor: ctx.config.background,
        format: "png"
      })
    );
  } catch (error) {
    ctx.log.error("renderer: capture failed", { error });

    return undefined;
  }
}

/** The resolution the pixel oracle reads the stage at: a quarter of the pixels, a 2-px change still shows. */
const ORACLE_RESOLUTION = 0.5;

/**
 * Draws the stage live into RGBA pixels with Pixi's extract system, framed as a capture is, at
 * half resolution. A failed read is logged once per application state and answers `undefined`.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param app - The application that draws.
 * @param resolution - Device pixels per CSS pixel of the read; half by default.
 * @returns The pixels, or `undefined` when Pixi could not read them.
 */
export function readPixels(
  ctx: RendererCtx,
  app: PixiApplication,
  resolution = ORACLE_RESOLUTION
): Uint8ClampedArray | undefined {
  try {
    return app.renderer.extract.pixels({
      target: app.stage,
      frame: app.screen,
      clearColor: ctx.config.background,
      resolution
    }).pixels;
  } catch (error) {
    if (!ctx.state.host.pixelsFailed) {
      ctx.state.host.pixelsFailed = true;
      ctx.log.error("renderer: pixel read failed", { error });
    }

    return undefined;
  }
}
