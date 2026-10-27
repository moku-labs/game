/**
 * @file world/projection — warm windows (spec 33, slice B+D). A mounted projection that declares `warm` keeps the
 * view of that item built aside and held hidden while `from` does not show its key: `isBuilding` answers for it, so ui
 * and the renderer build it in parts and keep it off stage. One step a frame, in the idle time of a live world, builds,
 * patches or drops a held view; the reconcile shows the held view when `from` brings its key, and a close leaves the
 * record cold, to be built again. A world that stops being live drops the view in work. An element registered for a
 * closed window is held with it, and the sweep forgets the held entities that are gone. A projection `hold` mounted
 * has a record too: it holds `from`'s first item instead of the `warm` one until `show` (`hold.ts`).
 */
import type { Snapshot } from "../../model/types";
import type { AnyComponentValue, Entity } from "../ecs/types";
import { deepEquals, diffComponents } from "./diff";
import { cancelTracks } from "./driver";
import { finishHandles, writeRestNow } from "./motions";
import { seedMutes } from "./mutes";
import type {
  AnyProjectionSpec,
  MotionCause,
  Mounted,
  ProjectionCtx,
  ProjectionState,
  Track,
  View,
  WarmRecord
} from "./types";
import { asError, collectView, createViewRecord, spawnFlagged, writeValue } from "./views";

/** A second in ms: the frame interval is this over the frame rate. */
const SECOND_MS = 1000;

/** The share of a frame interval a warm window may take: two thirds, the share of a scene build's `"auto"`. */
const WARM_SHARE = 2 / 3;

/** The budget of a frame when the loop answers no usable rate: two thirds of a 60 Hz frame, ≈ 11.1 ms. */
export const FALLBACK_WARM_MS = (SECOND_MS / 60) * WARM_SHARE;

/**
 * The building budget of one frame for a warm window: two thirds of the frame interval at `fps`, or of a 60 Hz frame
 * for a rate that is not a finite number above 0. Pure.
 *
 * @param fps - The rate the loop runs at.
 * @returns Milliseconds per frame.
 * @example
 * ```ts
 * warmBudget(120); // 5.555…
 * ```
 */
export function warmBudget(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? (SECOND_MS / fps) * WARM_SHARE : FALLBACK_WARM_MS;
}

/**
 * Tells whether two items have the same content: the same object, or equal as JSON. Pure.
 *
 * @param before - The item the view was built for.
 * @param after - The item that comes.
 * @returns True when nothing of the view has to change.
 * @example
 * ```ts
 * sameItem({ page: "main" }, { page: "main" }); // true
 * ```
 */
export function sameItem(before: unknown, after: unknown): boolean {
  return before === after || deepEquals(before, after);
}

/** A warm record that holds a view. */
export type HeldRecord = WarmRecord & { view: View };

/**
 * Tells whether a record holds a view.
 *
 * @param record - The record.
 * @returns True when it holds one.
 */
function holds(record: WarmRecord): record is HeldRecord {
  return record.view !== undefined;
}

/**
 * Tells whether a record was read against the state of this snapshot.
 *
 * @param seen - The state the record last read.
 * @param snapshot - The state now.
 * @returns True when neither root changed since.
 */
function isSeen(seen: Snapshot | undefined, snapshot: Snapshot): boolean {
  return seen !== undefined && seen.player === snapshot.player && seen.session === snapshot.session;
}

/**
 * Gives a mounted projection that declares `warm`, or is held, its record, cold, at the end of the warm list. A
 * projection that has one keeps it: a projection a scene before mounted and the coming one keeps (F23) keeps its held
 * view.
 *
 * @param state - The projection branch of the plugin state.
 * @param spec - The projection spec.
 */
export function ensureWarm(state: ProjectionState, spec: AnyProjectionSpec): void {
  if (state.warm.has(spec.name)) return;
  if (spec.warm === undefined && !state.held.has(spec.name)) return;

  const record: WarmRecord = { name: spec.name, entities: new Set<Entity>(), phase: "cold" };

  state.warm.set(spec.name, record);
  state.warmList.push(record);
  state.warmStale = true;
}

/**
 * The record whose held view a new key of a projection shows: one that holds a view of that key, built or still in
 * work. Only a mounted projection has a record: a name is in one table only, so a projection a scene build mounts
 * aside has none.
 *
 * @param state - The projection branch of the plugin state.
 * @param name - The projection.
 * @param key - The key that enters.
 * @returns The record, or `undefined` when the key spawns as before.
 */
export function heldFor(state: ProjectionState, name: string, key: string): HeldRecord | undefined {
  if (state.warm.size === 0) return undefined;

  const record = state.warm.get(name);

  if (record === undefined || !holds(record) || record.phase === "shown" || record.key !== key) {
    return undefined;
  }

  return record;
}

/**
 * Despawns what a record holds: its view, with the cause `"discard"` and no motion, then every entity `adopt` marked
 * for it that is still there. The removal hooks still see them held. A shown view belongs to `mounted` and is left
 * alone. The record keeps its phase; the caller sets it.
 *
 * @param pctx - Domain context of the projection module.
 * @param record - The record.
 */
function dropHeld(pctx: ProjectionCtx, record: WarmRecord): void {
  const state = pctx.ctx.state.projection;
  const ecs = pctx.deps.ecs;
  const view = record.view;

  if (view !== undefined && record.phase !== "shown") {
    cancelTracks(pctx, view.entity);
    state.byEntity.delete(view.entity);
    state.mutes.delete(view.entity);
    state.rests.delete(view.entity);
    view.cause = "discard";
    state.leaving.set(view.entity, "discard");
    state.membershipVersion += 1;
    ecs.despawn(view.entity);
  }

  for (const entity of record.entities) {
    if (ecs.ownerOf(entity) !== undefined) ecs.despawn(entity);
  }

  for (const entity of record.entities) state.warmHeld.delete(entity);
  record.entities.clear();
}

/**
 * Leaves a record cold: nothing held, no longer in work, and the warm step looks at it again.
 *
 * @param state - The projection branch of the plugin state.
 * @param record - The record.
 */
function coolRecord(state: ProjectionState, record: WarmRecord): void {
  record.phase = "cold";
  delete record.key;
  delete record.item;
  delete record.view;
  if (state.warmActive === record) delete state.warmActive;
  state.warmStale = true;
}

/**
 * Drops what a record holds and leaves it cold, to be built again by the warm step.
 *
 * @param pctx - Domain context of the projection module.
 * @param record - The record.
 */
export function discardWarm(pctx: ProjectionCtx, record: WarmRecord): void {
  dropHeld(pctx, record);
  coolRecord(pctx.ctx.state.projection, record);
  delete record.seen;
}

/**
 * Drops the held view of every record and leaves it cold: a restore or a load replaces the state (ui would build held
 * roots again in one block with its others), and a forced rerun runs `view` anew (a new locale). A view `from` shows
 * is a live view and stays; its record is warmed again after the close.
 *
 * @param pctx - Domain context of the projection module.
 */
export function discardHeld(pctx: ProjectionCtx): void {
  for (const record of pctx.ctx.state.projection.warmList) discardWarm(pctx, record);
}

/**
 * Drops the record in work at the start of a scene build: its parts would hold the build's readiness. A ready record
 * stays held and rests until the build ends; a cold one has nothing.
 *
 * @param pctx - Domain context of the projection module.
 */
export function discardActive(pctx: ProjectionCtx): void {
  const active = pctx.ctx.state.projection.warmActive;

  if (active !== undefined) discardWarm(pctx, active);
}

/**
 * Forgets the record of a projection that is unmounted: its held view and the entities marked for it are despawned.
 *
 * @param pctx - Domain context of the projection module.
 * @param name - The projection.
 */
export function forgetWarm(pctx: ProjectionCtx, name: string): void {
  const state = pctx.ctx.state.projection;
  const record = state.warm.get(name);

  if (record === undefined) return;

  discardWarm(pctx, record);
  state.warm.delete(name);
  state.warmList.splice(state.warmList.indexOf(record), 1);
}

/**
 * Drops every held view and forgets every record, every held name and every owed `show`: the clear of the projections.
 *
 * @param pctx - Domain context of the projection module.
 */
export function clearWarm(pctx: ProjectionCtx): void {
  const state = pctx.ctx.state.projection;

  for (const record of state.warmList) dropHeld(pctx, record);

  state.warm.clear();
  state.warmList.length = 0;
  state.warmHeld.clear();
  state.held.clear();
  state.showing.length = 0;
  delete state.warmActive;
  state.warmStale = false;
}

/**
 * Marks an entity another plugin spawned for the record in work, so `isBuilding` answers for it and a discard
 * despawns it with the view. Does nothing while no record is in work.
 *
 * @param state - The projection branch of the plugin state.
 * @param entity - The entity.
 */
export function adoptWarm(state: ProjectionState, entity: Entity): void {
  const active = state.warmActive;

  if (active === undefined) return;

  active.entities.add(entity);
  state.warmHeld.add(entity);
}

/**
 * Holds an element whose key a plugin registers under a projection whose warm window is closed: the record holds a
 * view, not shown, and the projection shows no live view, so the element can only be one of the held root's, made
 * after the record was ready (a row a windowed list ranges in after the solve). It joins the record as an adopted one:
 * `isBuilding` answers true, `entityOf` nothing, until the open; a discard despawns it with the view. A projection
 * that shows other keys live while it warms one is not covered: an element registered for it is taken as live.
 *
 * @param state - The projection branch of the plugin state.
 * @param projection - The projection the key is registered under.
 * @param entity - The element.
 */
export function holdRegistered(state: ProjectionState, projection: string, entity: Entity): void {
  if (state.warm.size === 0) return;

  const record = state.warm.get(projection);

  if (record?.view === undefined || record.phase === "shown") return;
  if (state.mounted.get(projection)?.live.size !== 0) return;

  record.entities.add(entity);
  state.warmHeld.add(entity);
}

/** What the prune's callback reads: set before the walk, so the callback is module-level and a walk makes no closure. */
const pruning: { pctx: ProjectionCtx | undefined } = { pctx: undefined };

/**
 * Forgets one held entity when it is gone: out of the held set and out of the record that marked it.
 *
 * @param entity - The held entity.
 * @param _same - The same entity, as a set hands it twice.
 * @param held - The held set.
 */
function dropDeadHeld(entity: Entity, _same: Entity, held: Set<Entity>): void {
  const pctx = pruning.pctx;

  if (pctx === undefined || pctx.deps.ecs.ownerOf(entity) !== undefined) return;

  held.delete(entity);

  const list = pctx.ctx.state.projection.warmList;

  for (let index = 0; index < list.length; index += 1) list[index]?.entities.delete(entity);
}

/**
 * Forgets the held entities that are gone: the elements a plugin despawned while their window was held (the rows a
 * refresh took away), so the held sets of a window held for a long session do not grow. The sweep calls it after a
 * frame that despawned an entity; with nothing held it reads one size.
 *
 * @param pctx - Domain context of the projection module.
 */
export function forgetDeadHeld(pctx: ProjectionCtx): void {
  const held = pctx.ctx.state.projection.warmHeld;

  if (held.size === 0) return;

  const outer = pruning.pctx;

  pruning.pctx = pctx;
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Set, read without an iterator, by a module-level callback
  held.forEach(dropDeadHeld);
  pruning.pctx = outer;
}

/**
 * The budget `left()` counts down in this frame: the scene build's, else the warm window's while one is in work.
 *
 * @param state - The projection branch of the plugin state.
 * @returns Milliseconds per frame, or `undefined` while nothing is built.
 */
export function frameBudget(state: ProjectionState): number | undefined {
  if (state.building !== undefined) return state.building.budgetMs;

  return state.warmActive === undefined ? undefined : state.warmBudgetMs;
}

/**
 * Shows the held view of a record: it and every entity marked for it stop being held, the view joins the live views
 * of its projection with the cause of the reconcile, and the record is shown. A record still in work leaves the work:
 * ui builds the rest of its root in one block.
 *
 * @param pctx - Domain context of the projection module.
 * @param mounted - The mounted projection.
 * @param record - The record that holds the view.
 * @param cause - `"mount"` for a direct reconcile, `"change"` for a live one.
 */
export function showHeld(
  pctx: ProjectionCtx,
  mounted: Mounted,
  record: HeldRecord,
  cause: MotionCause
): void {
  const state = pctx.ctx.state.projection;
  const view = record.view;

  for (const entity of record.entities) state.warmHeld.delete(entity);
  record.entities.clear();
  if (state.warmActive === record) delete state.warmActive;

  record.phase = "shown";
  view.cause = cause;
  mounted.live.set(view.key, view);
  state.membershipVersion += 1;
}

/**
 * The close of a window: when the view leaving is the one a record showed, the record goes cold and is built again
 * in idle frames. The exit itself runs as for any view.
 *
 * @param state - The projection branch of the plugin state.
 * @param name - The projection.
 * @param view - The view that leaves the live views.
 */
export function coolShown(state: ProjectionState, name: string, view: View): void {
  const record = state.warm.get(name);

  if (record?.view !== view) return;

  coolRecord(state, record);
  delete record.seen;
}

/**
 * Writes the difference between a view's rest pose and a new output of `view` straight onto its entity: added and
 * changed components are written, removed ones taken off, no hook runs and no motion plays. The direct write of a
 * changed item, for a held view and for the one the open shows.
 *
 * @param pctx - Domain context of the projection module.
 * @param view - The view.
 * @param next - The new output of `view(item)`, by component name.
 * @param item - The item it was made from.
 */
export function writeDifference(
  pctx: ProjectionCtx,
  view: View,
  next: Map<string, AnyComponentValue>,
  item: unknown
): void {
  const { changed } = diffComponents(view.rest, next, pctx.deps.components.Tree.componentName);

  for (const [name, value] of next) {
    if (!view.rest.has(name)) writeValue(pctx, view.entity, value);
  }

  for (const [name, value] of view.rest) {
    if (!next.has(name)) pctx.deps.ecs.remove(view.entity, value.type);
  }

  view.rest = next;
  view.item = item;
  finishHandles(view);
  writeRestNow(pctx, view, changed);
}

/**
 * Tells whether a motion that owns its fields and ends runs: a track that is not additive and does not repeat
 * forever. A loop adds to its fields and runs for good, and a track that repeats forever never ends, so neither holds
 * the warm work back.
 *
 * @param tracks - The tracks the projection started.
 * @returns True while one such track is active.
 */
function ownedMotionRuns(tracks: readonly Track[]): boolean {
  const count = tracks.length;

  // Per frame while there is warm work: an index loop, no callback.
  for (let index = 0; index < count; index += 1) {
    const track = tracks[index];

    if (track !== undefined && !track.additive && !track.forever && track.handle.active()) {
      return true;
    }
  }

  return false;
}

/**
 * Tells whether the world may warm now: live, no scene build, and a drawing plugin that registered an `onBuild`
 * check (a headless world warms nothing).
 *
 * @param pctx - Domain context of the projection module.
 * @returns True when the warm step may run.
 */
function mayWarm(pctx: ProjectionCtx): boolean {
  const state = pctx.ctx.state.projection;

  return (
    state.building === undefined && state.buildChecks.length > 0 && pctx.deps.ecs.mode() === "live"
  );
}

/**
 * Polls the checks of the record in work: when every one answers true its view is built, the record is ready and
 * `left()` is `Infinity` again.
 *
 * @param state - The projection branch of the plugin state.
 * @param active - The record in work.
 */
function pollActive(state: ProjectionState, active: WarmRecord): void {
  const checks = state.buildChecks;
  const count = checks.length;

  for (let index = 0; index < count; index += 1) {
    if (checks[index]?.() !== true) return;
  }

  active.phase = "ready";
  delete state.warmActive;
}

/**
 * The first item `from` gives: the first of a list, or the one object of a screen.
 *
 * @param spec - The projection spec.
 * @param snapshot - The state now.
 * @returns The item, or `undefined` for an empty list.
 */
function firstItem(spec: AnyProjectionSpec, snapshot: Snapshot): unknown {
  const source: unknown = spec.from(snapshot.player, snapshot.session);

  return Array.isArray(source) ? (source as readonly unknown[])[0] : source;
}

/**
 * Reads the item a record holds and its key: `from`'s first item while the projection is held, else the item `warm`
 * gives. A `warm`, a `from` or a `key` that throws is logged as a projection that failed, and nothing is held.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec, which declares `warm` or is held.
 * @param snapshot - The state now.
 * @returns The item and its key, or `undefined` for no item and for a throw.
 */
function readWarm(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  snapshot: Snapshot
): { item: unknown; key: string } | undefined {
  try {
    const item = pctx.ctx.state.projection.held.has(spec.name)
      ? firstItem(spec, snapshot)
      : spec.warm?.(snapshot.player, snapshot.session);

    if (item === undefined || item === null) return undefined;

    return { item, key: spec.key?.(item) ?? spec.name };
  } catch (error) {
    pctx.ctx.log.error("world:projection-failed", { projection: spec.name }, asError(error));

    return undefined;
  }
}

/**
 * Runs `view` for a warm item. A throw is logged as a projection that failed.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param item - The warm item.
 * @returns The component values, or `undefined` when `view` threw.
 */
function viewOfItem(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  item: unknown
): Map<string, AnyComponentValue> | undefined {
  try {
    return collectView(pctx, spec, item);
  } catch (error) {
    pctx.ctx.log.error("world:projection-failed", { projection: spec.name }, asError(error));

    return undefined;
  }
}

/**
 * Starts the work of a record: it becomes the record in work, `left()` counts the warm budget from the frame rate
 * the loop runs at, and the loop is woken, so the building frames come at the full rate.
 *
 * @param pctx - Domain context of the projection module.
 * @param record - The record.
 */
function startWork(pctx: ProjectionCtx, record: WarmRecord): void {
  const state = pctx.ctx.state.projection;

  record.phase = "building";
  state.warmActive = record;
  state.warmBudgetMs = warmBudget(pctx.ctx.deps.time.rate().fps);
  pctx.ctx.deps.time.wake();
}

/**
 * Spawns the held view of a warm item, as a scene build spawns a view: bare, flagged held, then its `Layer` and its
 * view components, so an `onAdded` hook already asks `isBuilding` true, and with `"change"` as its cause, so its
 * enter plays when it is shown. The record is in work from before the spawn: what ui marks in its hooks is the
 * record's. Nothing is spawned when `view` throws.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param record - The cold record.
 * @param warm - The warm item and its key.
 * @param warm.item - The warm item.
 * @param warm.key - Its key.
 */
function spawnWarm(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  record: WarmRecord,
  warm: { item: unknown; key: string }
): void {
  const values = viewOfItem(pctx, spec, warm.item);

  if (values === undefined) return;

  const state = pctx.ctx.state.projection;

  startWork(pctx, record);

  const entity = spawnFlagged(pctx, spec, values, state.warmHeld);
  const view = createViewRecord(entity, spec.name, warm.key, warm.item, values, "change");

  record.entities.add(entity);
  // The spawn wrote the `initialOnly` fields from `view`; from here on they are another writer's.
  seedMutes(state, spec, entity);
  state.byEntity.set(entity, view);
  record.view = view;
  record.key = warm.key;
  record.item = warm.item;
}

/**
 * Brings a ready record up to the warm item a commit gave: the same content changes nothing; the same key writes the
 * difference into the held view, which ui builds again in parts; another key drops the view and spawns the new one.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @param record - The ready record.
 * @param warm - The warm item and its key.
 * @param warm.item - The warm item.
 * @param warm.key - Its key.
 * @returns True when the step did work.
 */
function refreshWarm(
  pctx: ProjectionCtx,
  spec: AnyProjectionSpec,
  record: WarmRecord,
  warm: { item: unknown; key: string }
): boolean {
  const view = record.view;

  if (view !== undefined && warm.key === record.key) {
    if (sameItem(record.item, warm.item)) return false;

    const next = viewOfItem(pctx, spec, warm.item);

    if (next === undefined) {
      dropHeld(pctx, record);
      coolRecord(pctx.ctx.state.projection, record);

      return true;
    }

    startWork(pctx, record);
    writeDifference(pctx, view, next, warm.item);
    record.item = warm.item;

    return true;
  }

  dropHeld(pctx, record);
  coolRecord(pctx.ctx.state.projection, record);
  spawnWarm(pctx, spec, record, warm);

  return true;
}

/**
 * One record's turn in the warm step: a record shown, in work, or read against this state is passed over. Otherwise
 * its item is read (`warm`, or `from`'s first while held): with no item, or with a key `from` shows, what is held is
 * dropped; a cold record spawns its held view, a ready one is brought up to date.
 *
 * @param pctx - Domain context of the projection module.
 * @param record - The record.
 * @param snapshot - The state now.
 * @returns True when the step did work, so the frame takes no more.
 */
function stepRecord(pctx: ProjectionCtx, record: WarmRecord, snapshot: Snapshot): boolean {
  if (record.phase === "shown" || record.phase === "building") return false;
  if (isSeen(record.seen, snapshot)) return false;

  const state = pctx.ctx.state.projection;
  // A record lives while its projection is mounted, and a mounted projection is registered.
  const spec = state.specs.get(record.name);

  if (spec === undefined) return false;

  // Read once per state: a throw is logged once per commit, not on every frame.
  record.seen = snapshot;

  const warm = readWarm(pctx, spec, snapshot);

  if (warm === undefined || state.mounted.get(record.name)?.items.has(warm.key) === true) {
    if (record.view === undefined) return false;

    dropHeld(pctx, record);
    coolRecord(state, record);

    return true;
  }

  if (record.phase === "ready") return refreshWarm(pctx, spec, record, warm);

  spawnWarm(pctx, spec, record, warm);

  return record.view !== undefined;
}

/**
 * Takes the next record that has work, in mounted order, and does its one step. A walk that finds none leaves the
 * world at rest until a commit or a close.
 *
 * @param pctx - Domain context of the projection module.
 */
function stepNext(pctx: ProjectionCtx): void {
  const state = pctx.ctx.state.projection;
  const snapshot = pctx.ctx.deps.model.store.snapshot();

  // Only when there is work, after a commit or a close: the iterator is no cost of a frame at rest.
  for (const record of state.warmList) {
    if (stepRecord(pctx, record, snapshot)) return;
  }

  state.warmStale = false;
}

/**
 * One step of the warm windows, run in world's `input` callback after the reconcile. At rest it reads two fields and
 * returns. It runs only in a live world with no scene build, a drawing plugin, and no motion that owns its fields and
 * ends: the frames of an animation get no warm step. Where it may not run, the record in work is dropped: a paused or
 * fast world builds no part of it, and `left()` would stay finite for good; it is built again once the step runs.
 * While a record is in work its checks are polled; otherwise the next record with work spawns, patches or drops its
 * held view. One step a frame.
 *
 * @param pctx - Domain context of the projection module.
 */
export function stepWarm(pctx: ProjectionCtx): void {
  const state = pctx.ctx.state.projection;
  const active = state.warmActive;

  if (active === undefined && !state.warmStale) return;

  if (!mayWarm(pctx)) {
    if (active !== undefined) discardWarm(pctx, active);

    return;
  }

  if (ownedMotionRuns(state.tracks)) return;

  if (active === undefined) stepNext(pctx);
  else pollActive(state, active);
}
