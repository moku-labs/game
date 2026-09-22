/**
 * @file renderer/sync — the pools. A released object keeps its class and its texture key, so the
 * next entity with the same look gets it back without an allocation.
 */
import type { PixiContainer, PixiNineSliceSprite, PixiSprite } from "../types";
import type { SyncCtx, SyncState, View, ViewKind } from "./types";

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
 * Tells whether a display object is a nine-slice sprite.
 *
 * @param object - The display object.
 * @returns True for a nine-slice sprite.
 */
export function isNineSlice(object: PixiContainer): object is PixiNineSliceSprite {
  return "leftWidth" in object;
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
 * Takes the clip rectangle off a view: the wrapper stops masking and the graphics goes.
 *
 * @param view - The view of a shape that clips, or of anything that does not.
 */
export function dropMask(view: View): void {
  const mask = view.mask;

  if (mask === undefined) return;

  // eslint-disable-next-line unicorn/no-null -- `null` is how Pixi clears a mask.
  if (view.wrapper !== undefined) view.wrapper.mask = null;

  detach(mask);
  mask.destroy();
  view.mask = undefined;
}

/**
 * The pool an object belongs to: its class and the texture it draws.
 *
 * @param kind - Which component gave the entity its display object.
 * @param textureKey - The asset key.
 * @returns The pool key.
 * @example
 * ```ts
 * poolKeyOf("Sprite", "board.cell"); // "Sprite:board.cell"
 * ```
 */
export function poolKeyOf(kind: ViewKind, textureKey: string): string {
  return `${kind}:${textureKey}`;
}

/**
 * Brings a display object back to the state a fresh one has.
 *
 * @param object - The display object.
 */
export function resetObject(object: PixiContainer): void {
  detach(object);
  object.visible = true;
  object.alpha = 1;
  object.rotation = 0;
  object.zIndex = 0;
  object.position.set(0, 0);
  object.pivot.set(0, 0);
  object.scale.set(1);
  if (isSprite(object)) object.tint = 0xff_ff_ff;
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
 * Puts a view's object back into its pool and evicts the oldest one when the pool grew past the
 * configured limit. A `Display` object belongs to the game and is only detached.
 *
 * @param sctx - Domain context of the sync module.
 * @param view - The view that left.
 */
export function release(sctx: SyncCtx, view: View): void {
  const state = sctx.ctx.state.sync;

  dropMask(view);

  if (view.wrapper !== undefined) {
    detach(view.wrapper);
    view.wrapper.destroy({ children: false });
    view.wrapper = undefined;
  }

  if (view.kind === "Display") {
    detach(view.object);

    return;
  }

  if (view.kind === "adapter") {
    detach(view.object);
    view.display?.adapter.destroy(view.object);

    return;
  }

  resetObject(view.object);

  const pool = state.pools.get(view.poolKey) ?? emptyPool();

  pool.push(view.object);
  state.pools.set(view.poolKey, pool);
  state.pooled += 1;

  while (state.pooled > sctx.ctx.config.poolLimit) {
    const oldest = oldestPool(state);

    if (oldest === undefined) return;

    oldest.shift()?.destroy({ texture: false });
    state.pooled -= 1;
  }
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
 * Destroys the pooled objects that draw one of these keys, so a bundle that left frees its GPU
 * memory instead of waiting for a reuse that resolves nothing.
 *
 * @param state - The sync branch of the plugin state.
 * @param keys - The asset keys that went stale.
 */
export function dropPooled(state: SyncState, keys: readonly string[]): void {
  for (const key of keys) {
    for (const kind of ["Sprite", "NineSlice"] as const) {
      const pool = state.pools.get(poolKeyOf(kind, key));

      if (pool === undefined) continue;

      for (const object of pool) object.destroy({ texture: false });
      state.pooled -= pool.length;
      state.pools.delete(poolKeyOf(kind, key));
    }
  }
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
