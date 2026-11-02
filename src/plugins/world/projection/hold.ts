/**
 * @file world/projection — held projections (F103). `hold` mounts a projection that shows nothing while it is held:
 * the warm machinery keeps the view of `from`'s first item built aside and hidden, in idle frames, as it keeps a warm
 * window. `show` releases the name, and the next reconcile shows `from`'s item through the warm open path: the held
 * view is adopted, no spawn. The leave loader of `scenes` is the case: held while a scene stands, shown when a switch
 * takes long enough. `feed` hands it the switch its `from` reads as a third argument (F107): stored while held, read
 * again by name while shown.
 */
import type { Owner } from "../ecs/types";
import { placeNames, reconcileFresh, sortMount, unmountNames } from "./mount";
import { reconcile } from "./reconcile";
import type { ProjectionCtx, SceneSwitch } from "./types";

/**
 * Mounts projections held: the checks of a mount first, so a throw holds nothing; then every name joins the held set
 * before its record is made and before the reconcile, which shows none of its items. A record a projection had
 * already (its `warm`) reads its item again, from `from` now, with the value the first `feed` after this hold stores,
 * else the one fed before. Every name of the list is reconciled at once, direct: a kept one that showed views drops
 * them.
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
    state.heldFed.delete(name);
    delete state.warm.get(name)?.seen;
  }

  state.warmStale = true;
  placeNames(pctx, names, owner);
  reconcileFresh(pctx, names);
}

/**
 * Releases a held projection: it is held no more, its `from` and its record are read again, the next reconcile
 * reconciles it by name, and its `from` reads the latest value fed. A name that is not held changes nothing.
 *
 * @param pctx - Domain context of the projection module.
 * @param name - The projection.
 */
export function showName(pctx: ProjectionCtx, name: string): void {
  const state = pctx.ctx.state.projection;

  if (!state.held.delete(name)) return;

  state.heldFed.delete(name);
  // Its last reconcile showed nothing: the next one reads `from` again, also on the same state.
  delete state.mounted.get(name)?.seen;
  // A record the reconcile does not adopt (`from` brings another key, or none) reads its own item again.
  delete state.warm.get(name)?.seen;
  state.warmStale = true;
  state.showing.push(name);
}

/**
 * Tells whether two switches are equal field by field. Pure.
 *
 * @param before - The switch stored.
 * @param after - The switch fed.
 * @returns True when `from`, `to` and `progress` are the same.
 * @example
 * ```ts
 * sameSwitch({ from: "ward", to: "board", progress: 0.5 }, { from: "ward", to: "board", progress: 0.5 }); // true
 * ```
 */
function sameSwitch(before: SceneSwitch, after: SceneSwitch): boolean {
  return before.from === after.from && before.to === after.to && before.progress === after.progress;
}

/**
 * Hands a projection the switch its `from` reads. An equal value changes nothing and allocates nothing. Another one is
 * stored; then a held name keeps the value its warm step reads (the first feed after `hold` sets it, so a later commit
 * re-reads the held item with it and a feed never rebuilds the held view), a mounted shown name is read again by name
 * in the next reconcile (its `seen` dropped, its name on `showing` once), and a name not mounted is only stored.
 *
 * @param pctx - Domain context of the projection module.
 * @param name - The projection.
 * @param sw - The switch.
 */
export function feedName(pctx: ProjectionCtx, name: string, sw: SceneSwitch): void {
  const state = pctx.ctx.state.projection;
  const stored = state.fed.get(name);
  const held = state.held.has(name);

  // The first feed after `hold` is the value the held item is read with, also when it equals the stored one.
  if (held && !state.heldFed.has(name)) state.heldFed.set(name, sw);

  if (stored !== undefined && sameSwitch(stored, sw)) return;

  state.fed.set(name, sw);

  if (held) return;

  const mounted = state.mounted.get(name);

  if (mounted === undefined) return;

  // Its last reconcile read the same state: the next one reads `from` again, by name, with no commit.
  delete mounted.seen;
  if (!state.showing.includes(name)) state.showing.push(name);
}

/**
 * Reconciles the projections `show` released and the shown ones `feed` changed since the last reconcile, by name: a
 * running scene build would pass over a mounted projection its list does not name. A live world plays the enter of the
 * view it shows; a world that is not live shows it direct. Nothing runs while none was released.
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
