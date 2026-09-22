/**
 * @file assets plugin — the default I/O seam in a browser: the global `fetch`, `createImageBitmap`
 * and the texture registry of `renderer`. Nothing here imports Pixi.
 */
import type { Api as RendererApi } from "../renderer/types";
import type { AssetsIo, CreateTextureOptions, DecodedImage, FetchResponse, Texture } from "./types";

/**
 * Fetches one URL with the global `fetch`.
 *
 * @param url - The URL of the manifest or of one file.
 * @param init - Carries the abort signal of the running load.
 * @param init.signal - Aborts the request when the load is cancelled.
 * @returns The response.
 * @example
 * ```ts
 * const response = await browserFetch("/assets/manifest.json", { signal });
 * response.status; // 200
 * ```
 */
export function browserFetch(url: string, init: { signal: AbortSignal }): Promise<FetchResponse> {
  return fetch(url, { signal: init.signal });
}

/**
 * Decodes one image file off the main thread.
 *
 * @param blob - The bytes of a PNG or WebP file.
 * @returns The decoded bitmap.
 * @example
 * ```ts
 * const bitmap = await browserDecode(await response.blob());
 * bitmap.width; // 128
 * ```
 */
export function browserDecode(blob: Blob): Promise<DecodedImage> {
  return createImageBitmap(blob);
}

/**
 * Builds the I/O seam a game gets when it configures none: the browser pair plus the texture
 * registry of `renderer`, which is the only place a Pixi texture is made or freed.
 *
 * @param renderer - The resolved renderer API.
 * @returns The default io.
 * @example
 * ```ts
 * // What `onStart` does when the renderer draws and the game configured no `io`.
 * const io = createBrowserIo(ctx.require(rendererPlugin));
 * io.createTexture(bitmap, { nine: [48, 48, 48, 48] }); // a Pixi texture with nine-slice borders
 * ```
 */
export function createBrowserIo(renderer: RendererApi): AssetsIo {
  return {
    fetch: browserFetch,
    decode: browserDecode,
    createTexture: (image: DecodedImage, options?: CreateTextureOptions): Texture =>
      renderer.sync.textures.create(image, options),
    destroyTexture: (texture: Texture): void => renderer.sync.textures.destroy(texture)
  };
}
