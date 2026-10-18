/**
 * @file world/projection — one reconcile: keyed items of the model against the live views, with
 * the cause table, the component diff, the retarget policy and the despawn queue.
 */
import type { Hint } from "../../flow/types";
import type { Snapshot } from "../../model/types";
import type { AnyComponentValue } from "../ecs/types";
import { diffComponents } from "./diff";
import { cancelTracks } from "./driver";
import { routeHint } from "./hints";
import {
  cancelHandles,
  createViewHandle,
  finishHandles,
  looseComponents,
  type Peers,
  playSettle,
  runHook,
  standsOffRest,
  stillMoving,
  writeRestNow,
  writeRestUnderLoops
} from "./motions";
import {
  dequeueRevive,
  despawnView,
  dropIfStill,
  enqueueExit,
  flushMounted,
  forgetDeadElements
} from "./queue";
import type {
  AnyProjectionSpec,
  ChangeHook,
  Counts,
  Mounted,
  ProjectionCtx,
  ReconcileOptions,
  View
} from "./types";
import { asError, collectView, createViewRecord, storedValue, writeValue } from "./views";

/**
 * Creates the empty set of used hints. It lives in its own non-exported function because lint
 * rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty set of hints.
 */
function emptyHintSet(): Set<Hint> {
  return new Set();
}

/**
 * Yields the component values behind a list of names, skipping a name the map does not hold.
 *
 * @param source - The component table to read.
 * @param names - The names the diff produced.
 * @yields {AnyComponentValue} One value per name the table holds.
 */
function* valuesOf(
  source: ReadonlyMap<string, AnyComponentValue>,
  names: readonly string[]
): Generator<AnyComponentValue> {
  for (const name of names) {
    const value = source.get(name);

    if (value !== undefined) yield value;
  }
}

/**
 * Fresh counters of one reconcile.
 *
 * @returns Every count at zero.
 */
function emptyCounts(): Counts {
  return {
    projections: 0,
    entered: 0,
    changed: 0,
    exited: 0,
    revived: 0,
    queued: 0,
    hintsRouted: 0,
    hintsDropped: 0
  };
}

/**
 * The name of the one component the diff compares by identity: the `Tree` of a screen, whose node
 * is a foreign object the world only carries.
 *
 * @param pctx - Domain context of the projection module.
 * @returns The component name.
 */
function treeName(pctx: ProjectionCtx): string {
  return pctx.deps.components.Tree.componentName;
}

/**
 * Finds the hint of one entry and records that it was used.
 *
 * @param pctx - Domain context of the projection module.
 * @param projection - Name of the projection.
 * @param key - The model key.
 * @param used - The hints that reached an entry.
 * @returns The hint, or `undefined`.
 */
function hintFor(
  pctx: ProjectionCtx,
  projection: string,
  key: string,
  used: Set<Hint>
): Hint | undefined {
  const hint = routeHint(pctx.ctx.state.projection.hints, projection, key);

  if (hint !== undefined) used.add(hint);

  return hint;
}

/**
 * A key that is new: spawn the entity with the projection's layer and the view components, then
 * play the `enter` hook and the `loop` hook when the reconcile plays motions. The loop is not
 * kept with the view's handles: a change cancels those, and the loop runs until the view dies.
 * A direct reconcile plays neither hook. The view then owes its loop, which the sweep starts.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param mounted - The mounted projection.
 * @param entry - The key, its item, the peers, the mode and the used hints.
 * @param entry.key - The model key.
 * @param entry.item - The model item.
 * @param entry.peers - The new and the old items.
 * @param entry.direct - Whether the reconcile writes without motions.
 * @param entry.used - The hints that reached an entry.
 */
function enterEntry(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  mounted: Mounted,
  entry: { key: string; item: unknown; peers: Peers; direct: boolean; used: Set<Hint> }
): void {
  const values = collectView(pctx, spec, entry.item);
  // `Layer` first: the ecs fires `onAdded` in list order, and the `Tree` hook of `ui` reads the
  // layer a JSX root draws in when it fires.
  const entity = pctx.deps.ecs.spawn({ kind: "projection", name: spec.name }, [
    pctx.deps.components.Layer({ name: spec.layer }),
    ...values.values()
  ]);
  const view = createViewRecord(
    entity,
    spec.name,
    entry.key,
    entry.item,
    values,
    entry.direct ? "mount" : "change"
  );

  mounted.live.set(entry.key, view);
  pctx.ctx.state.projection.byEntity.set(entity, view);
  pctx.ctx.state.projection.membershipVersion += 1;

  const hook = spec.motion?.enter;
  const loop = spec.motion?.loop;

  if (entry.direct) {
    view.loopOwed = true;
    pctx.ctx.state.projection.owedLoops += 1;

    return;
  }

  if (hook === undefined && loop === undefined) return;

  const handle = createViewHandle(pctx, view, entry.peers);

  if (hook !== undefined) {
    const hint = hintFor(pctx, spec.name, entry.key, entry.used);
    const played = runHook(pctx, view, "enter", () => hook(handle, entry.item, hint, "change"));

    if (played?.motion !== undefined) view.handles.push(played.motion);
  }

  if (loop !== undefined) runHook(pctx, view, "loop", () => loop(handle));

  playSettle(pctx, view, spec, entry.peers, looseComponents(pctx, view));
}

/**
 * A key whose item is another object than before: structural changes are written, a changed
 * component with a hook is handed to it and one without is written directly, then the retarget
 * settles what is loose. A view no motion moves after that gets its pending `lift(false)`.
 *
 * In play mode an item with the same content is no change: when the component diff is empty the
 * new item is stored and nothing else happens. No motion of the view is cancelled, no hook runs,
 * nothing is written, no loose component is settled and no hint is used. A `from` that builds a
 * new object on every commit so keeps the motions of its views. A direct reconcile, and a forced
 * one, project the item as before.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param view - The live view.
 * @param entry - The item, the peers, the mode, the force flag, the used hints and the list a
 *   direct reconcile fills.
 * @param entry.item - The new model item.
 * @param entry.peers - The new and the old items.
 * @param entry.direct - Whether the reconcile writes without motions.
 * @param entry.force - Whether an unchanged item is projected again.
 * @param entry.used - The hints that reached an entry.
 * @param entry.rewritten - The views a direct reconcile wrote, written again after its flush.
 * @returns False when the item has the same content as before and was only stored.
 */
function changeEntry(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  view: View,
  entry: {
    item: unknown;
    peers: Peers;
    direct: boolean;
    force: boolean;
    used: Set<Hint>;
    rewritten: View[];
  }
): boolean {
  const next = collectView(pctx, spec, entry.item);
  const { added, changed, removed } = diffComponents(view.rest, next, treeName(pctx));
  const previous = view.item;
  const plays = !entry.direct && !entry.force;

  if (plays && added.length + changed.length + removed.length === 0) {
    view.item = entry.item;

    return false;
  }

  for (const value of valuesOf(next, added)) writeValue(pctx, view.entity, value);
  for (const value of valuesOf(view.rest, removed)) pctx.deps.ecs.remove(view.entity, value.type);

  view.rest = next;
  view.item = entry.item;

  if (entry.direct) {
    // Every rest key, not only the changed ones: a load during a motion has to converge in this
    // frame, so a component a cancelled motion left off its rest pose is written too.
    finishHandles(view);
    writeRestNow(pctx, view, [...next.keys()]);
    entry.rewritten.push(view);

    return true;
  }

  cancelHandles(view);

  const handle = createViewHandle(pctx, view, entry.peers);
  const hint = hintFor(pctx, spec.name, view.key, entry.used);
  const written: string[] = [];

  for (const name of changed) {
    // The stored table erases the item type; the spec that produced it typed the hook.
    const hook = spec.motion?.change?.[name] as ChangeHook<unknown> | undefined;

    if (hook === undefined) {
      written.push(name);

      continue;
    }

    const played = runHook(pctx, view, `change:${name}`, () =>
      hook(handle, previous, entry.item, hint)
    );

    if (played === undefined) written.push(name);
    else if (played.motion !== undefined) view.handles.push(played.motion);
  }

  // The loop of the view runs on: a value written under it keeps the offset and reaches the driver.
  writeRestUnderLoops(pctx, view, written);
  playSettle(pctx, view, spec, entry.peers, looseComponents(pctx, view));
  // The motions were cancelled: when no new one started, a pending `lift(false)` takes effect.
  dropIfStill(pctx, view);

  return true;
}

/**
 * A key that came back while its exit still played: the SAME view is revived, no `enter` and no
 * `change` hook runs, and one settle over the loose components brings it home. A view no motion
 * moves after that gets its pending `lift(false)`. Its cause is the way it came back.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param mounted - The mounted projection.
 * @param view - The queued view.
 * @param entry - The item, the peers, the mode and the list a direct reconcile fills.
 * @param entry.item - The new model item.
 * @param entry.peers - The new and the old items.
 * @param entry.direct - Whether the reconcile writes without motions.
 * @param entry.rewritten - The views a direct reconcile wrote, written again after its flush.
 */
function reviveEntry(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  mounted: Mounted,
  view: View,
  entry: { item: unknown; peers: Peers; direct: boolean; rewritten: View[] }
): void {
  cancelHandles(view);
  dequeueRevive(pctx, mounted, view, spec);
  view.cause = entry.direct ? "mount" : "change";

  const next = collectView(pctx, spec, entry.item);
  const { added, removed } = diffComponents(view.rest, next, treeName(pctx));

  for (const value of valuesOf(next, added)) writeValue(pctx, view.entity, value);
  for (const value of valuesOf(view.rest, removed)) pctx.deps.ecs.remove(view.entity, value.type);

  view.rest = next;
  view.item = entry.item;

  if (entry.direct) {
    writeRestNow(pctx, view, [...next.keys()]);
    entry.rewritten.push(view);

    return;
  }

  playSettle(pctx, view, spec, entry.peers, looseComponents(pctx, view));
  // The exit motion was cancelled: when no settle started, a pending `lift(false)` takes effect.
  dropIfStill(pctx, view);
}

/**
 * A live key that is gone: despawned at once without an `exit` hook, otherwise moved into the
 * despawn queue where it stays drawn until its motion ends. The view leaves with the cause of the
 * reconcile, so a removal hook can ask how it left.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param mounted - The mounted projection.
 * @param view - The view that left.
 * @param entry - The peers, the mode and the used hints.
 * @param entry.peers - The new and the old items.
 * @param entry.direct - Whether the reconcile writes without motions.
 * @param entry.used - The hints that reached an entry.
 */
function exitEntry(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  mounted: Mounted,
  view: View,
  entry: { peers: Peers; direct: boolean; used: Set<Hint> }
): void {
  const hook = spec.motion?.exit;

  mounted.live.delete(view.key);
  pctx.ctx.state.projection.membershipVersion += 1;
  view.cause = entry.direct ? "mount" : "change";

  if (entry.direct || hook === undefined) {
    despawnView(pctx, mounted, view);

    return;
  }

  cancelHandles(view);
  enqueueExit(pctx, mounted, view, spec);

  const handle = createViewHandle(pctx, view, entry.peers);
  const hint = hintFor(pctx, spec.name, view.key, entry.used);
  const played = runHook(pctx, view, "exit", () => hook(handle, view.item, hint, "change"));

  if (played?.motion !== undefined) view.handles.push(played.motion);
  if (!stillMoving(view)) despawnView(pctx, mounted, view);
}

/**
 * A live key whose item did not change, on a rollback: the same object, or in play mode a new
 * one with the same content. The failed node committed nothing, so no entry brings back a view
 * it moved with a motion or a timeline. A view that stands off its rest pose is settled as
 * `projection.settle(entity)` does: its motions are cancelled and the settle is played for the
 * loose components. With nothing loose a pending `lift(false)` takes effect. A view that stands
 * on its rest pose is left alone, so its motions run on. That holds for a view that loops too:
 * the value under its loop is what is compared. A direct reconcile only remembers the view: its
 * rest pose is written after the flush, in `writeUnchanged`.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param view - The live view whose item is the same as before.
 * @param entry - The peers, the mode and the list a direct reconcile fills.
 * @param entry.peers - The new and the old items.
 * @param entry.direct - Whether the reconcile writes without motions.
 * @param entry.unchanged - The unchanged views of a direct reconcile, written after its flush.
 */
function settleUnchanged(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  view: View,
  entry: { peers: Peers; direct: boolean; unchanged: View[] }
): void {
  if (entry.direct) {
    entry.unchanged.push(view);

    return;
  }

  if (!standsOffRest(pctx, view)) return;

  cancelHandles(view);
  playSettle(pctx, view, spec, entry.peers, looseComponents(pctx, view));
  // The motions were cancelled: when no new one started, a pending `lift(false)` takes effect.
  dropIfStill(pctx, view);
}

/**
 * Routes one key of the new state to the entry it belongs to: a live view changes, a queued view
 * revives, an unknown key enters.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param mounted - The mounted projection.
 * @param entry - The key, its item, the peers, the mode, the flags and the used hints.
 * @param entry.key - The model key.
 * @param entry.item - The model item.
 * @param entry.peers - The new and the old items.
 * @param entry.direct - Whether the reconcile writes without motions.
 * @param entry.force - Whether an unchanged item is projected again.
 * @param entry.settle - Whether an unchanged view that stands off its rest pose is settled.
 * @param entry.used - The hints that reached an entry.
 * @param entry.unchanged - The unchanged views of a direct reconcile that settles.
 * @param entry.rewritten - The views a direct reconcile wrote, written again after its flush.
 * @param counts - The counters of this reconcile.
 */
function applyEntry(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  mounted: Mounted,
  entry: {
    key: string;
    item: unknown;
    peers: Peers;
    direct: boolean;
    force: boolean;
    settle: boolean;
    used: Set<Hint>;
    unchanged: View[];
    rewritten: View[];
  },
  counts: Counts
): void {
  const live = mounted.live.get(entry.key);

  if (live !== undefined) {
    // The same object, or in play mode the same content: nothing to project. A restore and a
    // load still write its rest pose, once for every live view, in `convergeMounted`. A rollback
    // settles it when it stands off it.
    const same = !entry.force && live.item === entry.item;

    if (!same && changeEntry(pctx, spec, live, entry)) counts.changed += 1;
    else if (entry.settle) settleUnchanged(pctx, spec, live, entry);

    return;
  }

  const queued = mounted.queue.find(view => view.key === entry.key);

  if (queued === undefined) {
    enterEntry(pctx, spec, mounted, entry);
    counts.entered += 1;

    return;
  }

  reviveEntry(pctx, spec, mounted, queued, entry);
  counts.revived += 1;
}

/**
 * Sends every live key that is gone from the new state through the exit entry.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param mounted - The mounted projection.
 * @param next - The items of the new state, by key.
 * @param entry - The peers, the mode and the used hints.
 * @param entry.peers - The new and the old items.
 * @param entry.direct - Whether the reconcile writes without motions.
 * @param entry.used - The hints that reached an entry.
 * @param counts - The counters of this reconcile.
 */
function exitGone(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  mounted: Mounted,
  next: ReadonlyMap<string, unknown>,
  entry: { peers: Peers; direct: boolean; used: Set<Hint> },
  counts: Counts
): void {
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const view of [...mounted.live.values()]) {
    if (next.has(view.key)) continue;

    exitEntry(pctx, spec, mounted, view, entry);
    counts.exited += 1;
  }
}

/**
 * Reads the keyed items of one projection. A throw from `from` or `key` is reported and the
 * projection is skipped for this reconcile.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param snapshot - The model snapshot of this reconcile.
 * @returns The items by key, or `undefined` when the projection threw.
 */
function keyedItems(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  snapshot: Snapshot
): Map<string, unknown> | undefined {
  const next = new Map<string, unknown>();

  try {
    const source = spec.from(snapshot.player, snapshot.session);

    if (!Array.isArray(source)) {
      // A screen: one plain object, drawn under the name of the projection.
      if (source !== undefined && source !== null)
        next.set(spec.key?.(source) ?? spec.name, source);

      return next;
    }

    const key = spec.key;

    if (key === undefined) {
      throw new Error(
        `[game] Projection "${spec.name}" reads a list but declares no key.\n` +
          "  Add key(item), or let from return one object."
      );
    }

    for (const item of source) {
      const name = key(item);

      if (next.has(name)) {
        pctx.ctx.log.warn("world:duplicate-key", { projection: spec.name, key: name });

        continue;
      }

      next.set(name, item);
    }
  } catch (error) {
    pctx.ctx.log.error("world:projection-failed", { projection: spec.name }, asError(error));

    return undefined;
  }

  return next;
}

/**
 * The last step of a reconcile a restore or a load caused: every live view is written to its rest
 * pose, whether its item changed or not. An aborted node finishes its animation, which leaves a
 * view on the end pose, and a view whose item is the same object as before is never touched by
 * the entries. It runs after the flush: every handle is finished and every track of the entity is
 * cancelled by then, also an additive one, which writes its base back when it ends. So nothing
 * writes after it. Muted fields are left out, and `view` does not run again.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection, already flushed.
 */
function convergeMounted(pctx: ProjectionCtx, mounted: Mounted): void {
  for (const view of mounted.live.values()) writeRestNow(pctx, view, [...view.rest.keys()]);
}

/**
 * The last step of a direct reconcile that does not converge: every view an entry wrote is
 * written to its rest pose once more. The flush cancels the loop of a view with its other
 * tracks, and the driver writes the base it kept for the fields the loop added to back: the old
 * rest value. So the write of the entry, which came before the flush, would be lost in those
 * fields. Muted fields are left out.
 *
 * @param pctx - Domain context of the projection module.
 * @param rewritten - The live views a changed or revived entry wrote in this reconcile.
 */
function writeAgain(pctx: ProjectionCtx, rewritten: readonly View[]): void {
  for (const view of rewritten) writeRestNow(pctx, view, [...view.rest.keys()]);
}

/**
 * The last step of a direct reconcile a rollback caused: an unchanged view that stands off its
 * rest pose is written to it. It runs after the flush, as `convergeMounted` does and for the same
 * reason: the flush finishes the motions of the view, and a cancelled additive track writes its
 * base back, so the rest write has to come last. Muted fields are left out.
 *
 * @param pctx - Domain context of the projection module.
 * @param unchanged - The live views whose item did not change in this reconcile.
 */
function writeUnchanged(pctx: ProjectionCtx, unchanged: readonly View[]): void {
  for (const view of unchanged) {
    if (standsOffRest(pctx, view)) writeRestNow(pctx, view, [...view.rest.keys()]);
  }
}

/**
 * The same last step for the elements another plugin owns, which no reconcile of a projection
 * meets: each is written to the rest pose its owner recorded with `setRest`. Every track on the
 * entity is ended first, so nothing writes after it. Only a component the entity still carries
 * is written and muted fields are left out. An element that is leaving has its tracks ended and
 * keeps its place. The recorded pose and the registered key of an entity that is gone are
 * dropped before anything is written. A pose recorded for a projection view is skipped: its own
 * rest pose wins, as in `restOf`, and it is already home.
 *
 * @param pctx - Domain context of the projection module.
 */
function convergeElements(pctx: ProjectionCtx): void {
  const { ecs, components } = pctx.deps;
  const state = pctx.ctx.state.projection;

  forgetDeadElements(pctx);

  for (const [entity, rest] of state.rests) {
    if (state.byEntity.has(entity)) continue;

    cancelTracks(pctx, entity);

    if (ecs.has(entity, components.Exiting)) continue;

    const carried: string[] = [];

    for (const [name, value] of rest) {
      if (storedValue(pctx, entity, value.type) !== undefined) carried.push(name);
    }

    writeRestNow(pctx, createViewRecord(entity, "", "", undefined, rest), carried);
  }
}

/**
 * Tells every `onConverged` listener that the picture is home, so an owner puts back what only
 * it knows: `ui` builds its roots again. A listener that throws is logged and the others still
 * run.
 *
 * @param pctx - Domain context of the projection module.
 */
function tellConverged(pctx: ProjectionCtx): void {
  // eslint-disable-next-line unicorn/no-useless-spread -- a listener may remove itself
  for (const listener of [...pctx.ctx.state.projection.converged]) {
    try {
      listener();
    } catch (error) {
      pctx.ctx.log.error("world:converged-listener-failed", {}, asError(error));
    }
  }
}

/**
 * Reconciles one mounted projection against the snapshot.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param mounted - The mounted projection.
 * @param snapshot - The model snapshot of this reconcile.
 * @param options - Mode, force flag, converge flag and settle flag of this reconcile.
 * @param counts - The counters of this reconcile.
 * @param used - The hints that reached an entry.
 */
function reconcileOne(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  mounted: Mounted,
  snapshot: Snapshot,
  options: ReconcileOptions,
  counts: Counts,
  used: Set<Hint>
): void {
  const next = keyedItems(pctx, spec, snapshot);

  if (next === undefined) return;

  const peers: Peers = { next, previous: mounted.items };
  const unchanged: View[] = [];
  const rewritten: View[] = [];
  const entry = {
    peers,
    direct: options.direct,
    settle: options.settle,
    used,
    unchanged,
    rewritten
  };

  try {
    for (const [key, item] of next) {
      applyEntry(pctx, spec, mounted, { ...entry, key, item, force: options.force }, counts);
    }

    exitGone(pctx, spec, mounted, next, entry, counts);
  } catch (error) {
    pctx.ctx.log.error("world:projection-failed", { projection: spec.name }, asError(error));

    return;
  }

  mounted.items = next;

  if (options.direct) flushMounted(pctx, mounted);

  // A converge writes every live view, so it covers what the other two steps would write.
  if (options.converge) {
    convergeMounted(pctx, mounted);
  } else {
    writeAgain(pctx, rewritten);
    writeUnchanged(pctx, unchanged);
  }

  counts.queued += mounted.queue.length;
}

/**
 * Runs one reconcile over every mounted projection, or over the named ones only. A converging
 * one then brings the elements other plugins own home and tells their owners.
 *
 * @param pctx - Domain context of the projection module.
 * @param options - Which projections, play or direct, whether `view` is forced, whether every
 *   live view and every element is brought to its rest pose at the end, and whether an unchanged
 *   view that stands off its rest pose is settled.
 */
export function reconcile(pctx: ProjectionCtx, options: ReconcileOptions): void {
  const state = pctx.ctx.state.projection;
  const snapshot = pctx.ctx.deps.model.store.snapshot();
  const counts = emptyCounts();
  const used = emptyHintSet();

  for (const [name, mounted] of state.mounted) {
    if (options.names !== undefined && !options.names.includes(name)) continue;

    const spec = state.specs.get(name);

    if (spec === undefined) continue;

    counts.projections += 1;
    reconcileOne(pctx, spec, mounted, snapshot, options, counts, used);
  }

  if (options.converge) {
    convergeElements(pctx);
    tellConverged(pctx);
  }

  counts.hintsRouted = used.size;
  counts.hintsDropped = state.hints.length - used.size;

  if (pctx.ctx.config.reconciledEvent) {
    pctx.ctx.emit("world:reconciled", { mode: options.direct ? "direct" : "play", ...counts });
  }
}
