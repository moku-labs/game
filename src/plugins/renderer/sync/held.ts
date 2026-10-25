/**
 * @file renderer/sync — the held views of a scene build (spec 31, F61 S2): while `scenes` builds the next scene aside,
 * a view of it with no parent, or with a live parent (a kept projection, a slot host), is built but hung nowhere in
 * the stage. `attach` asks `holds` first; a held top is listed once, in the order it was made, and the pass after the
 * commit attaches the list in one block (`build.ts`).
 */
import type { Entity } from "../../world/types";
import { detach } from "./pools";
import type { PredrawState, SyncCtx, SyncState, View } from "./types";

/**
 * Tells whether a view is held: its entity belongs to the running build, and it has no parent or its parent is live.
 * A building view under a building parent hangs in the parent's tree, which is held as a whole. One set lookup for a
 * live entity.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity of the view.
 * @param parent - The entity its `Parent` names, 0 without one.
 * @returns True when the view must hang nowhere until the commit.
 */
export function holds(sctx: SyncCtx, entity: Entity, parent: Entity): boolean {
  const projection = sctx.ctx.deps.world.projection;

  return projection.isBuilding(entity) && (parent === 0 || !projection.isBuilding(parent));
}

/**
 * Holds a view of the build: out of the tree, no orphan, listed once in `heldViews`. A top keeps the name of the layer
 * it will hang in, which the coming scene may declare only after the commit.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 * @param layer - The layer it names; `""` for a view whose parent is live.
 */
export function holdView(sctx: SyncCtx, entity: Entity, view: View, layer: string): void {
  const state = sctx.ctx.state.sync;
  const held = state.heldViews;

  state.orphans.delete(entity);
  view.layer = layer;
  detach(view.wrapper ?? view.object);

  if (view.held) return;

  view.held = true;
  held.entities[held.count] = entity;
  held.count += 1;
}

/**
 * Empties the pre-draw for the next build: no piece, no top, the failure forgotten. The target stays for the device.
 *
 * @param predraw - The pre-draw branch of the sync state.
 */
export function resetPredraw(predraw: PredrawState): void {
  predraw.pieces.length = 0;
  predraw.count = 0;
  predraw.head = 0;
  predraw.next = 0;
  predraw.slot = -1;
  predraw.entity = 0;
  predraw.top = undefined;
  predraw.failed = false;
}

/**
 * Forgets the queues of a scene build with the tree, on a device loss, a rebuild or a stop: the views they name are
 * gone, and a rebuild holds every building view again. The pre-draw target belongs to the device and is destroyed.
 * Works on the state alone.
 *
 * @param state - The sync branch of the plugin state.
 */
export function forgetBuild(state: SyncState): void {
  const { aside, heldViews, predraw } = state;

  aside.count = 0;
  aside.head = 0;
  aside.made = 0;
  aside.waiting.clear();
  heldViews.count = 0;
  heldViews.reported = false;
  resetPredraw(predraw);
  predraw.target?.destroy(true);
  predraw.target = undefined;
}
