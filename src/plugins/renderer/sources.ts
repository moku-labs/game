/**
 * @file renderer plugin — how the renderer destroys a texture it owns whole, its source included: loaded files
 * (`sync`), kept pictures (`kept`) and the warm-up's probe target. A plain module of the plugin root, so neither
 * module imports the other's run-time code (L1).
 */
import type { PixiTexture } from "./types";

/**
 * Destroys a texture with its source, after the `change` listeners of the source and of its style
 * are removed: Pixi 8.22 caches batch and filter bind groups forever, and each one warns
 * `[BindGroup] ... destroyed while still bound to a shader` when a source it holds goes. For every
 * texture the renderer owns whole: loaded files, kept pictures, the warm-up target.
 *
 * @param texture - The texture, its source its own.
 */
export function destroyWhole(texture: PixiTexture): void {
  texture.source.style.removeAllListeners("change");
  texture.source.removeAllListeners("change");
  texture.destroy(true);
}
