/**
 * @file renderer/host — what a tool reads back from the one application: a PNG of the stage over
 * the whole canvas, and the textures the GPU holds with an estimate of their memory.
 */
import type { PixiApplication, RendererCtx } from "../types";
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
 * Pixi's canvas renderer keeps no GPU texture and answers zero.
 *
 * @param app - The application that draws.
 * @returns The count and the bytes.
 */
export function textureUsage(app: PixiApplication): TextureUsage {
  const system = app.renderer.texture;

  if (!("managedTextures" in system)) return { count: 0, bytes: 0 };

  const sources = system.managedTextures;
  let bytes = 0;

  for (const source of sources) bytes += sourceBytes(source);

  return { count: sources.length, bytes };
}

/**
 * Draws the stage into a PNG over the whole canvas, bars included, with Pixi's extract system. A
 * failed read is logged and answers `undefined`, so a caller never has to catch.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param app - The application that draws.
 * @returns A `data:image/png;base64,…` URL, or `undefined` when Pixi could not read the frame.
 */
export async function extractStage(
  ctx: RendererCtx,
  app: PixiApplication
): Promise<string | undefined> {
  try {
    return await app.renderer.extract.base64({
      target: app.stage,
      frame: app.screen,
      clearColor: ctx.config.background,
      format: "png"
    });
  } catch (error) {
    ctx.log.error("renderer: capture failed", { error });

    return undefined;
  }
}
