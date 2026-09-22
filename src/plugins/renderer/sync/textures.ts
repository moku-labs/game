/**
 * @file renderer/sync — the texture chain: the providers `assets` registers, the magenta
 * placeholder for a key nobody answers, the crops of `"cover"` sprites, and the two calls that
 * make and free a Pixi texture.
 */
import type { Entity } from "../../world/types";
import type { PixiTexture } from "../types";
import type { CreateTextureOptions, HitBox, SyncCtx, SyncState } from "./types";

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

  const bordered = new pixi.Texture({
    source: base.source,
    defaultBorders: { left: nine[0], top: nine[1], right: nine[2], bottom: nine[3] }
  });

  // Only the source of the wrapper is kept, so the wrapper itself goes; the source stays.
  base.destroy(false);

  return bordered;
}

/**
 * The cache key of one crop: the asset key and the box it covers.
 *
 * @param key - The asset key.
 * @param width - Width of the box.
 * @param height - Height of the box.
 * @returns The key of the crop.
 * @example
 * ```ts
 * frameKeyOf("board.bg", 1080, 1920); // "board.bg@1080x1920"
 * ```
 */
function frameKeyOf(key: string, width: number, height: number): string {
  return `${key}@${width}x${height}`;
}

/**
 * The texture a `"cover"` sprite draws: the part of `base` inside `crop`, sharing its source. One
 * crop per asset key and box, shared by every entity that shows it; the entity is added to its
 * users. A key that answers a new base has been invalidated, so every view of it resolves again
 * in this pass and joins the new crop; the old crop goes at once.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity that shows the crop.
 * @param key - The asset key the base was resolved for.
 * @param base - The texture the key resolves to.
 * @param box - The box the sprite covers, which names the crop.
 * @param box.width - Width of the box.
 * @param box.height - Height of the box.
 * @param crop - The part of the base to show, in texture pixels.
 * @returns The crop and its `frames` key, or the base and `""` while inert.
 */
export function coverTexture(
  sctx: SyncCtx,
  entity: Entity,
  key: string,
  base: PixiTexture,
  box: { width: number; height: number },
  crop: HitBox
): { texture: PixiTexture; frameKey: string } {
  const frames = sctx.ctx.state.sync.frames;
  const frameKey = frameKeyOf(key, box.width, box.height);
  const cached = frames.get(frameKey);

  if (cached?.base === base) {
    cached.users.add(entity);

    return { texture: cached.texture, frameKey };
  }

  const pixi = sctx.deps.host.pixi();

  if (pixi === undefined) return { texture: base, frameKey: "" };

  // The crop shares the base's source: freeing it must never free the image.
  if (cached !== undefined) cached.texture.destroy(false);

  const texture = new pixi.Texture({
    source: base.source,
    frame: new pixi.Rectangle(base.frame.x + crop.x, base.frame.y + crop.y, crop.width, crop.height)
  });
  const users = emptySet<Entity>();

  users.add(entity);
  frames.set(frameKey, { base, texture, users });

  return { texture, frameKey };
}

/**
 * Lets an entity go of the crop it showed. The last user frees the crop, keeping the source it
 * shares with its base.
 *
 * @param state - The sync branch of the plugin state.
 * @param entity - The entity that no longer shows it.
 * @param frameKey - The `frames` key of the crop; `""` for none.
 */
export function releaseCover(state: SyncState, entity: Entity, frameKey: string): void {
  const frame = state.frames.get(frameKey);

  if (frame === undefined) return;

  frame.users.delete(entity);

  if (frame.users.size > 0) return;

  frame.texture.destroy(false);
  state.frames.delete(frameKey);
}

/**
 * Frees the crops cut from one texture, keeping the source they share with it.
 *
 * @param state - The sync branch of the plugin state.
 * @param base - The texture that goes.
 */
function releaseFrames(state: SyncState, base: PixiTexture): void {
  for (const [frameKey, frame] of state.frames) {
    if (frame.base !== base) continue;

    frame.texture.destroy(false);
    state.frames.delete(frameKey);
  }
}

/**
 * Frees every crop. Works on the state alone, because `onStop` has no context.
 *
 * @param state - The sync branch of the plugin state.
 */
export function clearFrames(state: SyncState): void {
  for (const frame of state.frames.values()) frame.texture.destroy(false);

  state.frames.clear();
}

/**
 * Frees a texture, its source and the crops cut from it. A texture destroyed twice is a no-op.
 *
 * @param state - The sync branch of the plugin state.
 * @param texture - The texture to free.
 */
export function destroyTexture(state: SyncState, texture: PixiTexture): void {
  releaseFrames(state, texture);

  if (texture.destroyed) return;

  texture.destroy(true);
}
