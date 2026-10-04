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
 * Counts the texture sources the GPU holds and sums their estimated bytes. Pixi's
 * `managedTextures` exists on the WebGPU and the WebGL texture system alike (checked in 8.21);
 * Pixi's canvas renderer keeps no GPU texture and answers zero. Both systems answer
 * `Object.values` of a `GCManagedHash`, which keeps a `null` slot for every unloaded source, so
 * only the live sources are counted.
 *
 * @param app - The application that draws.
 * @returns The count and the bytes.
 */
export function textureUsage(app: PixiApplication): TextureUsage {
  const system = app.renderer.texture;

  if (!("managedTextures" in system)) return { count: 0, bytes: 0 };

  // Pixi's type says `TextureSource[]`, but an unloaded source leaves `null` in the list.
  const sources = system.managedTextures.filter(Boolean);
  let bytes = 0;

  for (const source of sources) bytes += sourceBytes(source);

  return { count: sources.length, bytes };
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
