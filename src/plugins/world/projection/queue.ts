/**
 * @file world/projection — the despawn queue and the frame sweep: an exited view stays drawn
 * until its last motion ends, and every flush empties the queue in the same call. The sweep and
 * the flush also apply a pending `lift(false)`, the sweep forgets what is kept of a dead element
 * and starts the loops the views owe.
 */

import type { Entity } from "../ecs/types";
import { cancelTracks, forgetEndedTracks } from "./driver";
import { checkConvergence, finishHandles, restingPeers, startLoop, stillMoving } from "./motions";
import type {
  AnyProjectionSpec,
  MotionCause,
  Mounted,
  ProjectionCtx,
  ProjectionKey,
  RestPose,
  View
} from "./types";
import { writeLayer } from "./views";

/**
 * Creates the empty item table of a flushed projection. It lives in its own non-exported function
 * because lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty item table.
 */
function emptyItems(): Map<string, unknown> {
  return new Map();
}

/**
 * Moves an exited view out of `live` into the despawn queue: it takes the `Exiting` tag, goes to
 * the lift layer when the projection has one, and stays drawn.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection.
 * @param view - The view that left.
 * @param spec - The projection spec.
 */
export function enqueueExit(
  pctx: ProjectionCtx,
  mounted: Mounted,
  view: View,
  spec: AnyProjectionSpec
): void {
  view.exiting = true;
  pctx.deps.ecs.tag(view.entity, pctx.deps.components.Exiting);
  if (spec.lift !== undefined) writeLayer(pctx, view.entity, spec.lift);
  mounted.queue.push(view);
}

/**
 * Despawns one view and forgets everything the projection kept about it, but the cause it leaves
 * with: that stays until the next sweep, so a removal hook can ask.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection.
 * @param view - The view to remove.
 */
export function despawnView(pctx: ProjectionCtx, mounted: Mounted, view: View): void {
  const at = mounted.queue.indexOf(view);

  if (at !== -1) mounted.queue.splice(at, 1);
  if (mounted.live.get(view.key) === view) mounted.live.delete(view.key);

  for (const handle of view.handles) handle.cancel();
  view.handles = [];
  cancelTracks(pctx, view.entity);

  const state = pctx.ctx.state.projection;

  state.byEntity.delete(view.entity);
  state.mutes.delete(view.entity);
  state.rests.delete(view.entity);
  state.leaving.set(view.entity, view.cause);
  state.membershipVersion += 1;
  pctx.deps.ecs.despawn(view.entity);
}

/**
 * Takes a view out of the despawn queue for a revive.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection.
 * @param view - The view that came back.
 * @param spec - The projection spec.
 */
export function dequeueRevive(
  pctx: ProjectionCtx,
  mounted: Mounted,
  view: View,
  spec: AnyProjectionSpec
): void {
  const at = mounted.queue.indexOf(view);

  if (at !== -1) mounted.queue.splice(at, 1);

  view.exiting = false;
  pctx.deps.ecs.untag(view.entity, pctx.deps.components.Exiting);
  writeLayer(pctx, view.entity, view.lifted && spec.lift !== undefined ? spec.lift : spec.layer);
  mounted.live.set(view.key, view);
  pctx.ctx.state.projection.membershipVersion += 1;
}

/**
 * Applies a pending `lift(false)`: the view leaves the lift layer for the layer of its
 * projection. A view the finger still holds carries no pending drop and stays lifted.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view whose last motion ended.
 */
export function dropPending(pctx: ProjectionCtx, view: View): void {
  if (!view.dropWhenStill) return;

  const spec = pctx.ctx.state.projection.specs.get(view.projection);

  if (spec === undefined) return;

  view.dropWhenStill = false;
  view.lifted = false;
  writeLayer(pctx, view.entity, spec.layer);
}

/**
 * Applies the pending `lift(false)` of a view no motion moves any more. A play reconcile and
 * `settle(entity)` call it where they cancelled the motions of a view: with nothing loose no new
 * motion starts, the view holds no handle, and the sweep skips a view without handles.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view whose motions were cancelled.
 */
export function dropIfStill(pctx: ProjectionCtx, view: View): void {
  if (!stillMoving(view)) dropPending(pctx, view);
}

/**
 * What the per-frame callbacks of the sweep read: set before each `forEach`, so the callbacks are
 * module-level and a frame makes no closure.
 */
const sweeping: { pctx: ProjectionCtx | undefined; live: boolean } = {
  pctx: undefined,
  live: false
};

/**
 * Forgets the cause of one view despawned since the last sweep, once its entity is gone.
 *
 * @param _cause - How the view left.
 * @param entity - Its entity.
 * @param leaving - The table of causes.
 */
function forgetLeft(_cause: MotionCause, entity: Entity, leaving: Map<Entity, MotionCause>): void {
  const pctx = sweeping.pctx;

  if (pctx === undefined || pctx.deps.ecs.ownerOf(entity) !== undefined) return;

  leaving.delete(entity);
  pctx.ctx.state.projection.membershipVersion += 1;
}

/**
 * Despawns the queued views of one projection whose motions ended, in queue order. The queue is
 * walked by index; a despawn takes the view out of it, so the index stays. Only the views queued
 * when the walk began are visited.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection.
 */
function despawnStill(pctx: ProjectionCtx, mounted: Mounted): void {
  const queue = mounted.queue;
  let left = queue.length;
  let index = 0;

  while (left > 0 && index < queue.length) {
    const view = queue[index];

    left -= 1;

    if (view === undefined || stillMoving(view)) {
      index += 1;

      continue;
    }

    despawnView(pctx, mounted, view);
    if (queue[index] === view) index += 1;
  }
}

/**
 * Settles one live view whose motions all ended: it is checked against its rest pose and gets its
 * pending `lift(false)`. A view still moving keeps the live walk on for the next frame.
 *
 * @param view - The view.
 */
function settleIfStill(view: View): void {
  const pctx = sweeping.pctx;

  if (pctx === undefined || view.handles.length === 0) return;

  if (stillMoving(view)) {
    pctx.ctx.state.projection.moving = true;

    return;
  }

  view.handles = [];
  checkConvergence(pctx, view);
  dropPending(pctx, view);
}

/**
 * Sweeps one mounted projection: its despawn queue, then its live views while one may move.
 *
 * @param mounted - The mounted projection.
 */
function sweepMounted(mounted: Mounted): void {
  const pctx = sweeping.pctx;

  if (pctx === undefined) return;
  if (mounted.queue.length > 0) despawnStill(pctx, mounted);
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a module-level callback
  if (sweeping.live) mounted.live.forEach(settleIfStill);
}

/**
 * The sweep of phase `animate`: the cause of every view despawned since the last sweep is
 * forgotten, queued views whose motions ended are despawned, and a live view that came to rest is
 * checked against its rest pose and gets its pending `lift(false)`. The live views are walked only
 * while one may move: every view handle sets the flag, and a walk that finds no view moving
 * clears it. A frame where nothing moves walks nothing and allocates nothing.
 *
 * @param pctx - Domain context of the projection module.
 */
export function sweepQueue(pctx: ProjectionCtx): void {
  const state = pctx.ctx.state.projection;

  sweeping.pctx = pctx;
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a module-level callback
  if (state.leaving.size > 0) state.leaving.forEach(forgetLeft);

  forgetEndedTracks(pctx);

  // A view handle made during the walk sets the flag again.
  sweeping.live = state.moving;
  state.moving = false;
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a module-level callback
  state.mounted.forEach(sweepMounted);
  sweeping.pctx = undefined;
}

/**
 * Drops the rest pose an owner recorded for an entity that is gone.
 *
 * @param _pose - The rest pose.
 * @param entity - Its entity.
 * @param rests - The table of rest poses.
 */
function dropDeadRest(_pose: RestPose, entity: Entity, rests: Map<Entity, RestPose>): void {
  if (sweeping.pctx?.deps.ecs.ownerOf(entity) === undefined) rests.delete(entity);
}

/**
 * Drops the key of an element whose entity is gone, and its side of the key table when the key
 * still names that entity.
 *
 * @param place - The projection and key of the element.
 * @param entity - Its entity.
 * @param keysByEntity - The reverse key table.
 */
function dropDeadKey(
  place: ProjectionKey,
  entity: Entity,
  keysByEntity: Map<Entity, ProjectionKey>
): void {
  const pctx = sweeping.pctx;

  if (pctx === undefined || pctx.deps.ecs.ownerOf(entity) !== undefined) return;

  keysByEntity.delete(entity);

  const byKey = pctx.ctx.state.projection.keys.get(place.projection);

  if (byKey?.get(place.key) === entity) byKey.delete(place.key);
}

/**
 * Drops what the projection keeps about an element whose entity is gone: the rest pose `setRest`
 * or `viewOf` recorded, and the key `registerKey` published. An owner that despawns its element
 * without calling the key remover leaves both, and `entityOf` would go on answering with an
 * entity that is gone. The sweep calls it after a frame that despawned an entity or registered a
 * key, and the converge step before it writes. A key a newer element took over stays, and the
 * remover that comes late is still safe.
 *
 * @param pctx - Domain context of the projection module.
 */
export function forgetDeadElements(pctx: ProjectionCtx): void {
  const state = pctx.ctx.state.projection;
  const outer = sweeping.pctx;

  sweeping.pctx = pctx;
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a module-level callback
  state.rests.forEach(dropDeadRest);
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, read without an iterator, by a module-level callback
  state.keysByEntity.forEach(dropDeadKey);
  sweeping.pctx = outer;
}

/**
 * Starts the loop of every live view that owes one and clears the flag: a view that entered in a
 * direct reconcile, and a view whose tracks a flush ended. The sweep calls it while a view owes
 * one, so it runs only while the world is live, which also covers a world that comes back from
 * `paused` or `fast` with no reconcile of its own. Without a tween driver nothing starts and the
 * views keep owing: the instant driver would write the end pose of the loop once. A view of a
 * projection without a `loop` hook only has its flag cleared.
 *
 * @param pctx - Domain context of the projection module.
 */
export function startOwedLoops(pctx: ProjectionCtx): void {
  const state = pctx.ctx.state.projection;

  if (state.driver === undefined) return;

  state.owedLoops = 0;

  for (const [name, mounted] of state.mounted) {
    const spec = state.specs.get(name);

    for (const view of mounted.live.values()) {
      if (!view.loopOwed) continue;

      view.loopOwed = false;
      if (spec !== undefined) startLoop(pctx, view, spec, restingPeers(mounted));
    }
  }
}

/**
 * Flushes one mounted projection: every motion is finished and the despawn queue is emptied in
 * the same call. The flush leaves a live view without a handle, and the sweep skips such a view,
 * so a pending `lift(false)` is applied here. It also ends the loop of a live view with its
 * other tracks, so the view owes its loop from here on.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection.
 */
export function flushMounted(pctx: ProjectionCtx, mounted: Mounted): void {
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const view of [...mounted.live.values()]) {
    finishHandles(view);
    cancelTracks(pctx, view.entity);
    dropPending(pctx, view);
    view.loopOwed = true;
    pctx.ctx.state.projection.owedLoops += 1;
  }
  // A copy: despawning splices the queue this loop walks.
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const view of [...mounted.queue]) {
    finishHandles(view);
    despawnView(pctx, mounted, view);
  }

  forgetEndedTracks(pctx);
}

/**
 * Flushes every mounted projection. The load, restore, fast-mode and owner-left path.
 *
 * @param pctx - Domain context of the projection module.
 */
export function flushQueues(pctx: ProjectionCtx): void {
  for (const mounted of pctx.ctx.state.projection.mounted.values()) flushMounted(pctx, mounted);
}

/**
 * Unmounts one projection: flush first, then despawn the live views too. They leave with their
 * screen, so their cause is `"mount"`; a queued view keeps the cause it left with.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection.
 */
export function clearMounted(pctx: ProjectionCtx, mounted: Mounted): void {
  flushMounted(pctx, mounted);
  // A copy: despawning deletes from the very map this loop walks.
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const view of [...mounted.live.values()]) {
    view.cause = "mount";
    despawnView(pctx, mounted, view);
  }
  mounted.items = emptyItems();
}
