/**
 * @file renderer/host — what a tool reads back from the one application: a PNG of the stage over
 * the whole canvas, some layers left out on request, and the textures the GPU holds with an
 * estimate of their memory.
 */
import type { PixiApplication, PixiContainer, RendererCtx } from "../types";
import type { TextureUsage } from "./types";

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
 * Counts the texture sources the GPU holds and sums their estimated bytes, split three ways: a
 * source with no upload method and no resource is a render target (a filter texture, a picture
 * Pixi renders into), one the engine keeps as a picture is kept, every other source is art.
 * Pixi's `managedTextures` exists on the WebGPU and the WebGL texture system alike (checked in
 * 8.22); Pixi's canvas renderer keeps no GPU texture and answers zero. Both systems answer
 * `Object.values` of a `GCManagedHash`, which keeps a `null` slot for every unloaded source, so
 * only the live sources are counted. An indexed walk: no array is made.
 *
 * @param app - The application that draws.
 * @param kept - The sources the engine keeps as pictures.
 * @returns The count, the bytes and their split.
 */
export function textureUsage(app: PixiApplication, kept: WeakSet<object>): TextureUsage {
  const system = app.renderer.texture;
  const usage: TextureUsage = { count: 0, bytes: 0, art: 0, targets: 0, kept: 0 };

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

    if (kept.has(source)) usage.kept += bytes;
    else if (isTarget(source)) usage.targets += bytes;
    else usage.art += bytes;
  }

  return usage;
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
