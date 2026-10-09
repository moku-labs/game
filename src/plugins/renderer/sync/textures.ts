/**
 * @file renderer/sync — the texture chain: the providers `assets` registers, the magenta
 * placeholder for a key nobody answers, the crops of `"cover"` sprites, and the calls that make,
 * slice and free a Pixi texture.
 */
import type { Entity } from "../../world/types";
import type { PixiModule, PixiTexture } from "../types";
import type {
  CreateTextureOptions,
  HitBox,
  NineBorders,
  SliceFrame,
  SyncCtx,
  SyncState
} from "./types";

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
 * The Pixi module of a renderer that draws. A texture made while it does not would be lost with
 * the device, so the member that asked throws.
 *
 * @param sctx - Domain context of the sync module.
 * @param member - The `textures` member that asked, for the message.
 * @returns The Pixi module.
 * @throws {Error} When the renderer does not draw.
 */
function drawingPixi(sctx: SyncCtx, member: "create" | "slice"): PixiModule {
  const pixi = sctx.deps.host.pixi();

  if (pixi === undefined || !sctx.deps.host.ready()) {
    throw new Error(
      `[game] renderer.sync.textures.${member} needs a ready renderer.\n` +
        "  Check app.renderer.host.ready() first."
    );
  }

  return pixi;
}

/**
 * The default borders of a texture, from the four numbers `nine` gives.
 *
 * @param nine - Left, top, right and bottom in pixels.
 * @returns The borders, as Pixi reads them.
 * @example
 * ```ts
 * defaultBordersOf([24, 20, 16, 12]); // { left: 24, top: 20, right: 16, bottom: 12 }
 * ```
 */
function defaultBordersOf(nine: NineBorders): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  return { left: nine[0], top: nine[1], right: nine[2], bottom: nine[3] };
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
  const pixi = drawingPixi(sctx, "create");
  const base = pixi.Texture.from(image);
  const nine = options?.nine;

  if (nine === undefined) return base;

  const bordered = new pixi.Texture({
    source: base.source,
    defaultBorders: defaultBordersOf(nine)
  });

  // Only the source of the wrapper is kept, so the wrapper itself goes; the source stays.
  base.destroy(false);

  return bordered;
}

/**
 * Tells whether a frame lies inside a page of the given size. A negative number, or one that is
 * not a number, lies outside.
 *
 * @param frame - The frame in page pixels.
 * @param page - The size of the page.
 * @param page.width - Width of the page in pixels.
 * @param page.height - Height of the page in pixels.
 * @returns True when the whole frame is on the page.
 * @example
 * ```ts
 * frameFits({ x: 256, y: 384, width: 256, height: 128 }, { width: 512, height: 512 }); // true
 * ```
 */
function frameFits(frame: SliceFrame, page: { width: number; height: number }): boolean {
  return (
    frame.x >= 0 &&
    frame.y >= 0 &&
    frame.width >= 0 &&
    frame.height >= 0 &&
    frame.x + frame.width <= page.width &&
    frame.y + frame.height <= page.height
  );
}

/**
 * Cuts a texture out of an atlas page, on behalf of `assets`. The slice shares the page's source,
 * its frame is offset by the page's own frame, and it is marked as a slice so `destroyTexture`
 * frees only the wrapper.
 *
 * @param sctx - Domain context of the sync module.
 * @param page - The page texture.
 * @param frame - The frame in page pixels.
 * @param options - Nine-slice borders, in pixels.
 * @returns The slice.
 * @throws {Error} When the renderer does not draw, and when the frame does not fit in the page.
 */
export function sliceTexture(
  sctx: SyncCtx,
  page: PixiTexture,
  frame: SliceFrame,
  options?: CreateTextureOptions
): PixiTexture {
  const pixi = drawingPixi(sctx, "slice");

  if (!frameFits(frame, page)) {
    throw new Error(
      `[game] renderer.sync.textures.slice: frame ${frame.x},${frame.y} ` +
        `${frame.width}x${frame.height} is outside page ${page.width}x${page.height}.\n` +
        '  Run "bun run assets:pack".'
    );
  }

  const nine = options?.nine;
  const slice = new pixi.Texture({
    source: page.source,
    frame: new pixi.Rectangle(
      page.frame.x + frame.x,
      page.frame.y + frame.y,
      frame.width,
      frame.height
    ),
    ...(nine === undefined ? {} : { defaultBorders: defaultBordersOf(nine) })
  });

  sctx.ctx.state.sync.slices.add(slice);

  return slice;
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
 * Frees a texture, its source and the crops cut from it. A slice keeps the source: it belongs to
 * the page, which frees it. A source that goes lets go of its `change` listeners first, the ones
 * of its style too, so no bind group Pixi still keeps is told. A texture destroyed twice is a
 * no-op.
 *
 * @param state - The sync branch of the plugin state.
 * @param texture - The texture to free.
 */
export function destroyTexture(state: SyncState, texture: PixiTexture): void {
  releaseFrames(state, texture);

  if (texture.destroyed) return;

  if (state.slices.has(texture)) {
    texture.destroy(false);

    return;
  }

  // Pixi 8.21 caches batch bind groups forever, and each one warns when a source it holds goes.
  texture.source.style.removeAllListeners("change");
  texture.source.removeAllListeners("change");
  texture.destroy(true);
}
