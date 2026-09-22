/**
 * @file world/projection — one reconcile: keyed items of the model against the live views, with
 * the cause table, the component diff, the retarget policy and the despawn queue.
 */
import type { Hint } from "../../flow/types";
import type { Snapshot } from "../../model/types";
import type { AnyComponentValue } from "../ecs/types";
import type { EmitReconciled } from "../types";
import { diffComponents } from "./diff";
import { routeHint } from "./hints";
import {
  cancelHandles,
  createViewHandle,
  finishHandles,
  looseComponents,
  type Peers,
  playSettle,
  runHook,
  stillMoving,
  writeRestNow
} from "./motions";
import { dequeueRevive, despawnView, enqueueExit, flushMounted } from "./queue";
import type {
  AnyProjectionSpec,
  ChangeHook,
  Counts,
  Mounted,
  ProjectionCtx,
  ReconcileOptions,
  View
} from "./types";
import { asError, collectView, createViewRecord, writeValue } from "./views";

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
 * A key that is new: spawn the entity with the view components and the projection's layer, then
 * play the `enter` hook when the reconcile plays motions.
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
  const entity = pctx.deps.ecs.spawn({ kind: "projection", name: spec.name }, [
    ...values.values(),
    pctx.deps.components.Layer({ name: spec.layer })
  ]);
  const view = createViewRecord(entity, spec.name, entry.key, entry.item, values);

  mounted.live.set(entry.key, view);
  pctx.ctx.state.projection.byEntity.set(entity, view);

  const hook = spec.motion?.enter;

  if (entry.direct || hook === undefined) return;

  const handle = createViewHandle(pctx, view, entry.peers);
  const hint = hintFor(pctx, spec.name, entry.key, entry.used);
  const played = runHook(pctx, view, "enter", () => hook(handle, entry.item, hint));

  if (played?.motion !== undefined) view.handles.push(played.motion);

  playSettle(pctx, view, spec, entry.peers, looseComponents(pctx, view));
}

/**
 * A key whose item changed: structural changes are written, a changed component with a hook is
 * handed to it and one without is written directly, then the retarget settles what is loose.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param view - The live view.
 * @param entry - The item, the peers, the mode and the used hints.
 * @param entry.item - The new model item.
 * @param entry.peers - The new and the old items.
 * @param entry.direct - Whether the reconcile writes without motions.
 * @param entry.used - The hints that reached an entry.
 */
function changeEntry(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  view: View,
  entry: { item: unknown; peers: Peers; direct: boolean; used: Set<Hint> }
): void {
  const next = collectView(pctx, spec, entry.item);
  const { added, changed, removed } = diffComponents(view.rest, next, treeName(pctx));
  const previous = view.item;

  for (const value of valuesOf(next, added)) writeValue(pctx, view.entity, value);
  for (const value of valuesOf(view.rest, removed)) pctx.deps.ecs.remove(view.entity, value.type);

  view.rest = next;
  view.item = entry.item;

  if (entry.direct) {
    // Every rest key, not only the changed ones: a load during a motion has to converge in this
    // frame, so a component a cancelled motion left off its rest pose is written too.
    finishHandles(view);
    writeRestNow(pctx, view, [...next.keys()]);

    return;
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

  writeRestNow(pctx, view, written);
  playSettle(pctx, view, spec, entry.peers, looseComponents(pctx, view));
}

/**
 * A key that came back while its exit still played: the SAME view is revived, no `enter` and no
 * `change` hook runs, and one settle over the loose components brings it home.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param mounted - The mounted projection.
 * @param view - The queued view.
 * @param entry - The item, the peers and the mode.
 * @param entry.item - The new model item.
 * @param entry.peers - The new and the old items.
 * @param entry.direct - Whether the reconcile writes without motions.
 */
function reviveEntry(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  mounted: Mounted,
  view: View,
  entry: { item: unknown; peers: Peers; direct: boolean }
): void {
  cancelHandles(view);
  dequeueRevive(pctx, mounted, view, spec);

  const next = collectView(pctx, spec, entry.item);
  const { added, removed } = diffComponents(view.rest, next, treeName(pctx));

  for (const value of valuesOf(next, added)) writeValue(pctx, view.entity, value);
  for (const value of valuesOf(view.rest, removed)) pctx.deps.ecs.remove(view.entity, value.type);

  view.rest = next;
  view.item = entry.item;

  if (entry.direct) {
    writeRestNow(pctx, view, [...next.keys()]);

    return;
  }

  playSettle(pctx, view, spec, entry.peers, looseComponents(pctx, view));
}

/**
 * A live key that is gone: despawned at once without an `exit` hook, otherwise moved into the
 * despawn queue where it stays drawn until its motion ends.
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

  if (entry.direct || hook === undefined) {
    despawnView(pctx, mounted, view);

    return;
  }

  cancelHandles(view);
  enqueueExit(pctx, mounted, view, spec);

  const handle = createViewHandle(pctx, view, entry.peers);
  const hint = hintFor(pctx, spec.name, view.key, entry.used);
  const played = runHook(pctx, view, "exit", () => hook(handle, view.item, hint));

  if (played?.motion !== undefined) view.handles.push(played.motion);
  if (!stillMoving(view)) despawnView(pctx, mounted, view);
}

/**
 * Routes one key of the new state to the entry it belongs to: a live view changes, a queued view
 * revives, an unknown key enters.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param mounted - The mounted projection.
 * @param entry - The key, its item, the peers, the mode, the force flag and the used hints.
 * @param entry.key - The model key.
 * @param entry.item - The model item.
 * @param entry.peers - The new and the old items.
 * @param entry.direct - Whether the reconcile writes without motions.
 * @param entry.force - Whether an unchanged item is projected again.
 * @param entry.used - The hints that reached an entry.
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
    used: Set<Hint>;
  },
  counts: Counts
): void {
  const live = mounted.live.get(entry.key);

  if (live !== undefined) {
    if (!entry.force && live.item === entry.item) return;

    changeEntry(pctx, spec, live, entry);
    counts.changed += 1;

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
 * Reconciles one mounted projection against the snapshot.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param mounted - The mounted projection.
 * @param snapshot - The model snapshot of this reconcile.
 * @param options - Mode and force flag of this reconcile.
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
  const entry = { peers, direct: options.direct, used };

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

  counts.queued += mounted.queue.length;
}

/**
 * Runs one reconcile over every mounted projection, or over the named ones only.
 *
 * @param pctx - Domain context of the projection module.
 * @param options - Which projections, play or direct, and whether `view` is forced.
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

  counts.hintsRouted = used.size;
  counts.hintsDropped = state.hints.length - used.size;

  if (pctx.ctx.config.reconciledEvent) {
    // The one narrowing of the plugin: see the note on `KernelSlice`. Only `emit` is cast.
    const emit = pctx.ctx.emit as EmitReconciled;

    emit("world:reconciled", { mode: options.direct ? "direct" : "play", ...counts });
  }
}

/**
 * Re-projects one view with the same item, used by `lift` and `settle` to reach the peers.
 *
 * @param mounted - The mounted projection.
 * @returns The peers of a call outside a reconcile: the items of the last one.
 */
export function restingPeers(mounted: Mounted): Peers {
  return { next: mounted.items, previous: mounted.items };
}
