/**
 * @file world/projection — the despawn queue: an exited view stays drawn until its last motion
 * ends, and every flush empties it in the same call.
 */
import { cancelTracks, forgetEndedTracks } from "./driver";
import { checkConvergence, finishHandles, stillMoving } from "./motions";
import type { AnyProjectionSpec, Mounted, ProjectionCtx, View } from "./types";
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
 * Despawns one view and forgets everything the projection kept about it.
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
  pctx.ctx.state.projection.byEntity.delete(view.entity);
  pctx.ctx.state.projection.mutes.delete(view.entity);
  pctx.ctx.state.projection.rests.delete(view.entity);
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
}

/**
 * The sweep of phase `animate`: queued views whose motions ended are despawned, and a live view
 * that came to rest is checked against its rest pose and gets its pending `lift(false)`.
 *
 * @param pctx - Domain context of the projection module.
 */
export function sweepQueue(pctx: ProjectionCtx): void {
  const state = pctx.ctx.state.projection;

  forgetEndedTracks(pctx);

  for (const [name, mounted] of state.mounted) {
    const spec = state.specs.get(name);

    // A copy: despawning splices the very list this loop walks.
    // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
    for (const view of [...mounted.queue]) {
      if (!stillMoving(view)) despawnView(pctx, mounted, view);
    }

    // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
    for (const view of [...mounted.live.values()]) {
      if (view.handles.length === 0 || stillMoving(view)) continue;

      view.handles = [];
      checkConvergence(pctx, view);

      if (view.dropWhenStill && spec !== undefined) {
        view.dropWhenStill = false;
        view.lifted = false;
        writeLayer(pctx, view.entity, spec.layer);
      }
    }
  }
}

/**
 * Flushes one mounted projection: every motion is finished and the despawn queue is emptied in
 * the same call.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection.
 */
export function flushMounted(pctx: ProjectionCtx, mounted: Mounted): void {
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const view of [...mounted.live.values()]) {
    finishHandles(view);
    cancelTracks(pctx, view.entity);
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
 * Unmounts one projection: flush first, then despawn the live views too.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection.
 */
export function clearMounted(pctx: ProjectionCtx, mounted: Mounted): void {
  flushMounted(pctx, mounted);
  // A copy: despawning deletes from the very map this loop walks.
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const view of [...mounted.live.values()]) despawnView(pctx, mounted, view);
  mounted.items = emptyItems();
}
