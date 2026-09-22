/**
 * @file renderer/sync — the texture chain: the providers `assets` registers, the magenta
 * placeholder for a key nobody answers, and the two calls that make and free a Pixi texture.
 */
import type { Entity } from "../../world/ecs/types";
import type { PixiTexture } from "../types";
import type { CreateTextureOptions, SyncCtx, SyncState } from "./types";

/** How big the placeholder is drawn, in reference units. */
export const PLACEHOLDER_SIZE = 64;

/** The colour a missing texture is drawn in. */
export const PLACEHOLDER_TINT = 0xff_00_ff;

/**
 * Creates an empty set. It lives in its own non-exported function because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @returns An empty set.
 */
function emptySet<Value>(): Set<Value> {
  return new Set();
}

/**
 * Asks the providers from the newest to the oldest. The first answer wins, so a bundle loaded
 * later shadows an older one.
 *
 * @param sctx - Domain context of the sync module.
 * @param key - The asset key.
 * @returns The texture, or `undefined` when nothing answered.
 */
export function resolveTexture(sctx: SyncCtx, key: string): PixiTexture | undefined {
  const providers = sctx.ctx.state.sync.providers;

  for (let index = providers.length - 1; index >= 0; index -= 1) {
    const texture = providers[index]?.(key);

    if (texture !== undefined) return texture;
  }

  return undefined;
}

/**
 * The 1x1 white texture the placeholder is drawn with.
 *
 * @param sctx - Domain context of the sync module.
 * @returns The texture, or `undefined` while inert.
 */
export function placeholderTexture(sctx: SyncCtx): PixiTexture | undefined {
  return sctx.deps.host.pixi()?.Texture.WHITE;
}

/**
 * Reports a key no provider answers. One key warns once, however many views use it.
 *
 * @param sctx - Domain context of the sync module.
 * @param key - The asset key.
 */
export function warnMissing(sctx: SyncCtx, key: string): void {
  const warned = sctx.ctx.state.sync.warned;

  if (key === "" || warned.has(key)) return;

  warned.add(key);
  sctx.ctx.log.warn("renderer: no texture for asset key", { key });
}

/**
 * Remembers that an entity draws a key, so `invalidate` finds it again.
 *
 * @param state - The sync branch of the plugin state.
 * @param entity - The entity.
 * @param key - The asset key.
 */
export function trackKey(state: SyncState, entity: Entity, key: string): void {
  const users = state.byKey.get(key) ?? emptySet<Entity>();

  users.add(entity);
  state.byKey.set(key, users);
}

/**
 * Forgets that an entity draws a key.
 *
 * @param state - The sync branch of the plugin state.
 * @param entity - The entity.
 * @param key - The asset key.
 */
export function untrackKey(state: SyncState, entity: Entity, key: string): void {
  const users = state.byKey.get(key);

  if (users === undefined) return;

  users.delete(entity);
  if (users.size === 0) state.byKey.delete(key);
}

/**
 * Makes a Pixi texture out of a decoded image, on behalf of `assets`.
 *
 * @param sctx - Domain context of the sync module.
 * @param image - The decoded image.
 * @param options - Nine-slice borders, in pixels.
 * @returns The new texture.
 * @throws {Error} When the renderer does not draw.
 */
export function createTexture(
  sctx: SyncCtx,
  image: ImageBitmap | HTMLImageElement,
  options?: CreateTextureOptions
): PixiTexture {
  const pixi = sctx.deps.host.pixi();

  if (pixi === undefined || !sctx.deps.host.ready()) {
    throw new Error(
      "[game] renderer.sync.textures.create needs a ready renderer.\n" +
        "  Check app.renderer.host.ready() first."
    );
  }

  const base = pixi.Texture.from(image);
  const nine = options?.nine;

  if (nine === undefined) return base;

  return new pixi.Texture({
    source: base.source,
    defaultBorders: { left: nine[0], top: nine[1], right: nine[2], bottom: nine[3] }
  });
}

/**
 * Frees a texture and its source. A texture destroyed twice is a no-op.
 *
 * @param texture - The texture to free.
 */
export function destroyTexture(texture: PixiTexture): void {
  if (texture.destroyed) return;

  texture.destroy(true);
}
