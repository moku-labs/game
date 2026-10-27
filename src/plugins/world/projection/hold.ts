/**
 * @file world/projection — held projections (F103). `hold` mounts a projection that shows nothing while it is held:
 * the warm machinery keeps the view of `from`'s first item built aside and hidden, in idle frames, as it keeps a warm
 * window. `show` releases the name, and the next reconcile shows `from`'s item through the warm open path: the held
 * view is adopted, no spawn. The leave loader of `scenes` is the case: held while a scene stands, shown when a switch
 * takes long enough.
 */
import type { Owner } from "../ecs/types";
import { placeNames, reconcileFresh, sortMount, unmountNames } from "./mount";
import { reconcile } from "./reconcile";
import type { ProjectionCtx } from "./types";

/**
 * Mounts projections held: the checks of a mount first, so a throw holds nothing; then every name joins the held set
 * before its record is made and before the reconcile, which shows none of its items. A record a projection had
 * already (its `warm`) reads its item again, from `from` now. Every name of the list is reconciled at once, direct: a
 * kept one that showed views drops them.
 *
 * @param pctx - Domain context of the projection module.
 * @param names - Names of the projections to hold.
 * @param owner - Who owns the entities of the new ones.
 * @throws {Error} For an unknown name, or a `layer` or `lift` the scene does not declare.
 */
export function holdNames(pctx: ProjectionCtx, names: readonly string[], owner: Owner): void {
  const state = pctx.ctx.state.projection;
  const { again } = sortMount(pctx, names, state.layers);

  unmountNames(pctx, again);

  for (const name of names) {
    state.held.add(name);
    delete state.warm.get(name)?.seen;
  }

  state.warmStale = true;
  placeNames(pctx, names, owner);
  reconcileFresh(pctx, names);
}

/**
 * Releases a held projection: it is held no more, its `from` and its record are read again, and the next reconcile
 * reconciles it by name. A name that is not held changes nothing.
 *
 * @param pctx - Domain context of the projection module.
 * @param name - The projection.
 */
export function showName(pctx: ProjectionCtx, name: string): void {
  const state = pctx.ctx.state.projection;

  if (!state.held.delete(name)) return;

  // Its last reconcile showed nothing: the next one reads `from` again, also on the same state.
  delete state.mounted.get(name)?.seen;
  // A record the reconcile does not adopt (`from` brings another key, or none) reads its own item again.
  delete state.warm.get(name)?.seen;
  state.warmStale = true;
  state.showing.push(name);
}

/**
 * Reconciles the projections `show` released since the last reconcile, by name: a running scene build would pass
 * over a mounted projection its list does not name. A live world plays the enter of the view it shows; a world that
 * is not live shows it direct. Nothing runs while none was released.
 *
 * @param pctx - Domain context of the projection module.
 */
export function reconcileShown(pctx: ProjectionCtx): void {
  const state = pctx.ctx.state.projection;
  const names = state.showing;

  if (names.length === 0) return;

  // A new list first: a hook of the shown view may release another name.
  state.showing = [];
  reconcile(pctx, {
    names,
    direct: pctx.deps.ecs.mode() !== "live",
    force: false,
    converge: false,
    settle: false
  });
}
