/**
 * @file renderer/sync — the pools. A released object keeps its class and its texture key, so the
 * next entity with the same look gets it back without an allocation.
 */
import type { PixiContainer, PixiGraphics, PixiSprite } from "../types";
import { clearArea, clearFilters } from "./filters";
import { clearHidden } from "./hidden";
import type { HollowSlice, SliceLike, SyncCtx, SyncState, View, ViewKind } from "./types";

/**
 * Tells whether a display object is a sprite. A `NineSliceSprite` carries the slice widths and
 * is recognised by them.
 *
 * @param object - The display object.
 * @returns True for a plain sprite.
 */
export function isSprite(object: PixiContainer): object is PixiSprite {
  return "texture" in object && !("leftWidth" in object);
}

/**
 * Tells whether a display object draws paths, so a `Shape` can be written onto it.
 *
 * @param object - The display object.
 * @returns True for a graphics object.
 */
export function isGraphics(object: PixiContainer): object is PixiGraphics {
  return "roundRect" in object;
}

/**
 * Tells whether a display object draws a nine-slice: Pixi's `NineSliceSprite`, or the engine's rim-only mesh of a
 * `hollow` one. Both carry the slice widths.
 *
 * @param object - The display object.
 * @returns True for either nine-slice object.
 */
export function isNineSlice(object: PixiContainer): object is SliceLike {
  return "leftWidth" in object;
}

/**
 * Tells whether a display object is the engine's rim-only nine-slice (F59).
 *
 * @param object - The display object.
 * @returns True for the hollow mesh, false for Pixi's `NineSliceSprite` and every other object.
 */
export function isHollow(object: PixiContainer): object is HollowSlice {
  return "hollow" in object;
}

/**
 * Takes a display object out of the Pixi tree. Pixi containers are not DOM nodes, so the DOM
 * helper the linter suggests does not exist on them.
 *
 * @param object - The display object.
 */
export function detach(object: PixiContainer): void {
  // eslint-disable-next-line unicorn/prefer-dom-node-remove -- a Pixi container is not a DOM node
  object.parent?.removeChild(object);
}

/**
 * Takes the masked container off a view: its children go back to the wrapper, unmasked and in
 * their order, and the container is freed.
 *
 * @param view - The view of a shape that clips, or of anything that does not.
 */
function dropClipped(view: View): void {
  const clipped = view.clipped;

  if (clipped === undefined) return;

  // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears a mask.
  clipped.mask = null;

  const wrapper = view.wrapper;

  if (wrapper !== undefined) for (const child of clipped.children) wrapper.addChild(child);

  detach(clipped);
  clipped.destroy();
  view.clipped = undefined;
}

/**
 * Takes the clip rectangle off a view: the children stop being masked and the graphics goes.
 *
 * @param view - The view of a shape that clips, or of anything that does not.
 */
export function dropMask(view: View): void {
  dropClipped(view);

  const mask = view.mask;

  if (mask === undefined) return;

  detach(mask);
  mask.destroy();
  view.mask = undefined;
}

/**
 * Takes the debug outline off a view: the graphics leaves the wrapper and is freed.
 *
 * @param view - The view of a nine-slice that was outlined, or of anything that was not.
 */
export function dropOutline(view: View): void {
  const outline = view.outline;

  if (outline === undefined) return;

  detach(outline);
  outline.destroy();
  view.outline = undefined;
}

/**
 * The pool an object belongs to: its class and the texture it draws. A rim-only nine-slice has a pool of its own, so
 * a filled panel never gets a hollow object back, nor the other way round.
 *
 * @param kind - Which component gave the entity its display object.
 * @param textureKey - The asset key.
 * @param hollow - True for the rim-only object of a `NineSlice` with `hollow: true`.
 * @returns The pool key.
 * @example
 * ```ts
 * poolKeyOf("NineSlice", "glass.frost", true); // "NineSlice.hollow:glass.frost"
 * ```
 */
export function poolKeyOf(kind: ViewKind, textureKey: string, hollow: boolean): string {
  return hollow ? `${kind}.hollow:${textureKey}` : `${kind}:${textureKey}`;
}

/**
 * Brings the object of a view that left back to the state a fresh one has: detached, drawn, opaque, unmoved, blending
 * normally, white.
 * Its hidden reasons go with `clearHidden`, so a pooled object never brings the reason of the view it belonged to; a
 * sprite and a graphics lose their tint (a fill-only shape is coloured by it, spec 26 R2.1).
 *
 * @param view - The view whose object goes back to its pool; its wrapper is gone already.
 */
export function resetObject(view: View): void {
  detach(view.object);
  clearHidden(view);
  resetNode(view.object);
}

/**
 * Brings a detached object back to a fresh one's pose and look: drawn, opaque, unmoved, blending as its parent (no
 * glow of the view it drew for), white for a sprite and a graphics.
 *
 * @param object - The object, out of the tree.
 */
function resetNode(object: PixiContainer): void {
  object.visible = true;
  object.alpha = 1;
  object.blendMode = "inherit";
  object.rotation = 0;
  object.zIndex = 0;
  object.position.set(0, 0);
  object.pivot.set(0, 0);
  object.scale.set(1);
  if (isSprite(object) || isGraphics(object)) object.tint = 0xff_ff_ff;
}

/**
 * Takes an object out of its pool, if one is waiting.
 *
 * @param state - The sync branch of the plugin state.
 * @param poolKey - Class and texture key.
 * @returns A reusable object, or `undefined`.
 */
export function acquire(state: SyncState, poolKey: string): PixiContainer | undefined {
  const pool = state.pools.get(poolKey);
  const object = pool?.pop();

  if (object !== undefined) state.pooled -= 1;

  return object;
}

/**
 * Creates the array a pool keeps its objects in. Lint rule L5 refuses a collection built inside
 * an exported declaration, so it lives here.
 *
 * @returns An empty pool.
 */
function emptyPool(): PixiContainer[] {
  return [];
}

/**
 * The pool that holds the object that has waited longest.
 *
 * @param state - The sync branch of the plugin state.
 * @returns A non-empty pool, or `undefined` when every pool is empty.
 */
function oldestPool(state: SyncState): PixiContainer[] | undefined {
  for (const pool of state.pools.values()) if (pool.length > 0) return pool;

  return undefined;
}

/**
 * Puts a view's object back into its pool and evicts the oldest one when the pool grew past the
 * configured limit. A `Display` object belongs to the game and is only detached. The filters and the
 * filter area the renderer hung on the object or its wrapper come off first, so a pooled object never
 * carries a filter into its next life; the filter instances themselves belong to `effects`.
 *
 * @param sctx - Domain context of the sync module.
 * @param view - The view that left.
 */
export function release(sctx: SyncCtx, view: View): void {
  // Strip what the renderer added to the view: mask, debug outline and filters.
  dropMask(view);
  dropOutline(view);
  clearFilters(view.object);
  // The filter area goes with the filters: a pooled object never keeps one (B4).
  clearArea(view.object);

  // The wrapper is the renderer's own container, so it is destroyed, never pooled.
  if (view.wrapper !== undefined) {
    clearFilters(view.wrapper);
    clearArea(view.wrapper);
    detach(view.wrapper);
    view.wrapper.destroy({ children: false });
    view.wrapper = undefined;
  }

  // A `Display` object belongs to the game: it only leaves the tree, without the renderer's hidden reasons.
  if (view.kind === "Display") {
    detach(view.object);
    clearHidden(view);

    return;
  }

  // An adapter object belongs to the plugin that drew it: its adapter destroys it, or keeps it drawn for a next life.
  if (view.kind === "adapter") {
    detach(view.object);
    clearHidden(view);
    view.display?.adapter.destroy(view.object);

    return;
  }

  // The renderer's own object goes back to its pool, reset for its next life: without a render group the kept
  // cache made of it (spec 23 P9.3).
  dropGroup(sctx, view.object);
  resetObject(view);
  store(sctx, view.object, view.poolKey);
}

/**
 * Puts an object a view no longer draws with back into a pool, while the view goes on with another one: the
 * nine-slice whose `hollow` flipped (F59). Reset as `release` resets a view's object; its view keeps its hidden
 * reasons, which hang on the view's wrapper.
 *
 * @param sctx - Domain context of the sync module.
 * @param object - The object, still in the view's wrapper.
 * @param poolKey - The pool it belongs to.
 */
export function releaseObject(sctx: SyncCtx, object: PixiContainer, poolKey: string): void {
  dropGroup(sctx, object);
  detach(object);
  resetNode(object);
  store(sctx, object, poolKey);
}

/**
 * Takes away the render group the kept cache made of an object (spec 23 P9.3), before it is pooled.
 *
 * @param sctx - Domain context of the sync module.
 * @param object - The object.
 */
function dropGroup(sctx: SyncCtx, object: PixiContainer): void {
  const groups = sctx.ctx.state.kept.madeGroups;

  if (!groups.has(object)) return;

  object.disableRenderGroup();
  groups.delete(object);
}

/**
 * Pushes a reset object into its pool and evicts the one that waited longest while the pools hold more than
 * `poolLimit`.
 *
 * @param sctx - Domain context of the sync module.
 * @param object - The reset object.
 * @param poolKey - Its pool.
 */
function store(sctx: SyncCtx, object: PixiContainer, poolKey: string): void {
  const state = sctx.ctx.state.sync;
  const pool = state.pools.get(poolKey) ?? emptyPool();

  pool.push(object);
  state.pools.set(poolKey, pool);
  state.pooled += 1;

  // Past the limit, the object that has waited longest is destroyed.
  while (state.pooled > sctx.ctx.config.poolLimit) {
    const oldest = oldestPool(state);

    if (oldest === undefined) return;

    oldest.shift()?.destroy({ texture: false });
    state.pooled -= 1;
  }
}

/**
 * Destroys the pooled objects that draw one of these keys, so a bundle that left frees its GPU
 * memory instead of waiting for a reuse that resolves nothing: sprites, nine-slices and rim-only nine-slices.
 *
 * @param state - The sync branch of the plugin state.
 * @param keys - The asset keys that went stale.
 */
export function dropPooled(state: SyncState, keys: readonly string[]): void {
  for (const key of keys) {
    dropPool(state, poolKeyOf("Sprite", key, false));
    dropPool(state, poolKeyOf("NineSlice", key, false));
    dropPool(state, poolKeyOf("NineSlice", key, true));
  }
}

/**
 * Destroys one pool and everything in it.
 *
 * @param state - The sync branch of the plugin state.
 * @param poolKey - The pool.
 */
function dropPool(state: SyncState, poolKey: string): void {
  const pool = state.pools.get(poolKey);

  if (pool === undefined) return;

  for (const object of pool) object.destroy({ texture: false });
  state.pooled -= pool.length;
  state.pools.delete(poolKey);
}

/**
 * Destroys everything the pools hold. Works on the state alone, because `onStop` has no context.
 *
 * @param state - The sync branch of the plugin state.
 */
export function destroyPools(state: SyncState): void {
  for (const pool of state.pools.values()) {
    for (const object of pool) object.destroy({ texture: false });
  }

  state.pools.clear();
  state.pooled = 0;
}
