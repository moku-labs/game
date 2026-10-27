/**
 * @file renderer/sync — the held views of a scene build (spec 31, F61 S2) and of warm windows (spec 33, slice B+D):
 * while `scenes` builds the next scene aside, or world keeps a closed window built, a view of it with no parent, or
 * with a live parent (a kept projection, a slot host), is built but hung nowhere in the stage. `attach` asks `holds`
 * first; a held top is listed once, in the order it was made, and the pass after world's membership version moved
 * attaches every listed top that is no longer building in one block (`build.ts`).
 */
import type { Entity } from "../../world/types";
import { detach } from "./pools";
import type { SyncCtx, SyncState, View } from "./types";

/** The version of a held list a view left: `membershipVersion()` never answers it, so the next pass scans the list. */
const RESCAN = -1;

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
 * it will hang in, which the coming scene may declare only after the commit. The first top of an empty list stores
 * world's membership version: it is building now, so only a later move can release it, and the pass is not woken for
 * a scan that would find nothing.
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

  if (held.count === 0) held.version = sctx.ctx.deps.world.projection.membershipVersion();

  view.held = true;
  held.entities[held.count] = entity;
  held.count += 1;
}

/**
 * Notes that a view leaves (its entity despawned, or its view replaced): a held one has the next pass scan the list
 * and drop its slot, also when world's membership version did not move (a discard of a build whose entities only
 * `adopt` marked). One field read for a view that is not held.
 *
 * @param state - The sync branch of the plugin state.
 * @param view - The view that leaves.
 */
export function leaveHeld(state: SyncState, view: View): void {
  if (view.held) state.heldViews.version = RESCAN;
}

/**
 * Forgets the queues of a scene build and the held windows with the tree, on a device loss, a rebuild or a stop: the
 * views they name are gone, and a rebuild holds every building view again. Works on the state alone.
 *
 * @param state - The sync branch of the plugin state.
 */
export function forgetBuild(state: SyncState): void {
  const { aside, heldViews } = state;

  aside.count = 0;
  aside.head = 0;
  aside.made = 0;
  aside.waiting.clear();
  heldViews.count = 0;
  heldViews.reported = false;
}
