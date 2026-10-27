/**
 * @file renderer/sync — the next scene built aside (spec 31, F61 S2) and the warm windows (spec 33, slice B+D). While
 * `scenes` builds the next scene, or world builds the view of a closed window, the pass sorts the building entities
 * out of `added` into the aside queue (world flags a view right after its atomic spawn, so `onAdded` cannot tell), and
 * after the live pass makes their views in chunks under `world.projection.left()`, parents first. A made view of the
 * build is held (`held.ts`): it hangs nowhere in the stage, so the hit test, the kept cache and the frame's render
 * passes never see it. A held window rests for as long as it is closed, asking for no frame. When world's membership
 * version moves (a commit, an open), the pass applies the layer list, attaches every held top that is no longer
 * building, in one block, and makes in the same pass the views of that build still queued aside: the scene or the
 * window is whole in the frame it is attached. The aside work moves nothing the live tree is counted by: `still()`
 * does not read the queue, and `passesVersion` stays.
 */
import type { Entity } from "../../world/types";
import type { PixiContainer } from "../types";
import { resort } from "./layers";
import { parentOf } from "./pose";
import type { AsideQueue, SyncCtx, SyncState } from "./types";
import { attach, createView } from "./views";

/** Views made between two reads of the clock: a read costs more than a small view. */
const CLOCK_EVERY = 8;

/**
 * Tells whether a scene or a warm window is being built: `left()` answers a finite number only while a build runs
 * or a window is in work. One field read when nothing is built.
 *
 * @param sctx - Domain context of the sync module.
 * @returns True while a build runs.
 */
export function buildRuns(sctx: SyncCtx): boolean {
  return sctx.ctx.deps.world.projection.left() !== Number.POSITIVE_INFINITY;
}

/**
 * Queues one building entity for its view, once.
 *
 * @param aside - The aside queue.
 * @param entity - The entity.
 */
function pushAside(aside: AsideQueue, entity: Entity): void {
  if (aside.waiting.has(entity)) return;

  aside.waiting.add(entity);
  aside.entities[aside.count] = entity;
  aside.count += 1;
}

/**
 * Moves the building entities of the pass's added set into the aside queue, in their order: the live pass builds the
 * rest. One set lookup per added entity; called only while a build runs.
 *
 * @param sctx - Domain context of the sync module.
 * @param taken - The entities the pass took out of `added`; the building ones leave it.
 */
export function sortAside(sctx: SyncCtx, taken: Set<Entity>): void {
  const projection = sctx.ctx.deps.world.projection;
  const aside = sctx.ctx.state.sync.aside;

  for (const entity of taken) {
    if (!projection.isBuilding(entity)) continue;

    taken.delete(entity);
    pushAside(aside, entity);
  }
}

/**
 * Forgets a queued entity that left before its view was made: the queue passes over it.
 *
 * @param state - The sync branch of the plugin state.
 * @param entity - The entity that left.
 */
export function dropAside(state: SyncState, entity: Entity): void {
  if (state.aside.count > 0) state.aside.waiting.delete(entity);
}

/**
 * Hands a queued entity whose build ended before its view was made to the live pass: it leaves the waiting set, and
 * joins `added` while it is alive.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity, no longer building.
 */
function toLivePass(sctx: SyncCtx, entity: Entity): void {
  const state = sctx.ctx.state.sync;

  state.aside.waiting.delete(entity);
  if (sctx.ctx.deps.world.ecs.ownerOf(entity) !== undefined) state.added.add(entity);
}

/**
 * Makes the view of one queued entity, its queued parent first (spec 16 U2.3: a child made before its parent finds no
 * parent view and is detached for good). The entity leaves the waiting set before its parent is made, so a cycle of
 * parents ends. A throw costs that entity.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param report - Logs a throw of one entity's work.
 * @returns The views made.
 */
function makeParentFirst(
  sctx: SyncCtx,
  entity: Entity,
  report: (entity: Entity, error: unknown) => void
): number {
  const waiting = sctx.ctx.state.sync.aside.waiting;

  if (!waiting.delete(entity)) return 0;

  const parent = parentOf(sctx.ctx.deps.world.ecs, entity);
  let made = parent !== 0 && waiting.has(parent) ? makeParentFirst(sctx, parent, report) : 0;

  try {
    if (createView(sctx, entity)) made += 1;
  } catch (error) {
    report(entity, error);
  }

  return made;
}

/**
 * Makes the views of the aside queue while the frame has budget: at least one, the clock read after the first and then
 * every `CLOCK_EVERY` views. An entity that is no longer building but still alive (its build ended before its view was
 * made) goes back to `added`, for the live pass. The made views hang nowhere in the stage, so the version the live
 * tree is counted at stays as it was.
 *
 * @param sctx - Domain context of the sync module.
 * @param report - Logs a throw of one entity's work.
 * @returns The views made.
 */
function makeAside(sctx: SyncCtx, report: (entity: Entity, error: unknown) => void): number {
  const state = sctx.ctx.state.sync;
  const { aside } = state;
  const projection = sctx.ctx.deps.world.projection;
  const version = state.passesVersion;
  let made = 0;
  let check = 1;

  while (aside.head < aside.count) {
    const entity = aside.entities[aside.head] ?? 0;

    aside.head += 1;

    if (!aside.waiting.has(entity)) continue;

    if (!projection.isBuilding(entity)) {
      toLivePass(sctx, entity);
      continue;
    }

    made += makeParentFirst(sctx, entity, report);

    if (made >= check) {
      if (projection.left() <= 0) break;

      check = made + CLOCK_EVERY;
    }
  }

  if (aside.head >= aside.count) {
    aside.head = 0;
    aside.count = 0;
  }

  // Held views are drawn nowhere: no render pass and no walk of `shown` moved (Q2, E4).
  state.passesVersion = version;

  return made;
}

/**
 * Tells whether a node hangs under the stage.
 *
 * @param node - The node.
 * @param stage - The stage.
 * @returns True when the stage is one of its ancestors.
 */
function underStage(node: PixiContainer, stage: PixiContainer): boolean {
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    if (parent === stage) return true;
  }

  return false;
}

/**
 * The dev check of a build frame: no view of a building entity hangs under the stage, or it would be drawn and hit
 * before the commit. Named once per build, as `renderer:building-drawn` with the entities. Dev and agent builds only,
 * in frames with aside work: it walks every view and makes a list, so a frame of resting warm windows never runs it.
 *
 * @param sctx - Domain context of the sync module.
 */
function checkDrawn(sctx: SyncCtx): void {
  const state = sctx.ctx.state.sync;
  const stage = sctx.deps.host.stage();

  if (state.heldViews.reported || stage === undefined) return;

  const projection = sctx.ctx.deps.world.projection;
  const drawn: Entity[] = [];

  for (const [entity, view] of state.views) {
    if (projection.isBuilding(entity) && underStage(view.wrapper ?? view.object, stage)) {
      drawn.push(entity);
    }
  }

  if (drawn.length === 0) return;

  state.heldViews.reported = true;
  sctx.ctx.log.warn("renderer:building-drawn", { entities: drawn });
}

/**
 * The building step of a frame, after the live pass: the views of the aside queue are made under the budget, and while
 * views wait to be made, or held views wait for a build that runs, the next frame is asked for. Held tops of warm
 * windows at rest wait for no frame: the pass attaches them when world's membership version moves. A few field reads
 * and no allocation with no build.
 *
 * @param sctx - Domain context of the sync module.
 * @param report - Logs a throw of one entity's work.
 */
export function stepAside(sctx: SyncCtx, report: (entity: Entity, error: unknown) => void): void {
  const state = sctx.ctx.state.sync;
  const { aside } = state;

  if (aside.made !== 0) aside.made = 0;

  // per frame: nothing waits to be made, and no build runs for the held tops (a resting window holds them for good).
  if (aside.head >= aside.count && (state.heldViews.count === 0 || !buildRuns(sctx))) return;

  if (aside.head < aside.count) aside.made = makeAside(sctx, report);

  sctx.deps.demand.request();

  // Inline and positive: a production `define` folds the guard, and the check leaves the bundle.
  if (
    (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
    (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
  ) {
    checkDrawn(sctx);
  }
}

/**
 * Tells whether held views may wait for the pass that attaches them: world's membership version moved since the list
 * was last scanned. A build ends only with such a move (a commit, a discard, the open of a warm window, a held view
 * dropped), so a list whose version stands holds building views only. Read by `still()`: two field reads.
 *
 * @param sctx - Domain context of the sync module.
 * @returns True when the pass has held views to look at again.
 */
export function heldWaiting(sctx: SyncCtx): boolean {
  const held = sctx.ctx.state.sync.heldViews;

  return held.count > 0 && sctx.ctx.deps.world.projection.membershipVersion() !== held.version;
}

/**
 * Hands the live pass every queued entity whose build ended before its view was made: a scene build committed, or a
 * window opened, while views of it still waited aside. The pass that attaches the held top makes them next, parents
 * first, so the top never hangs on the stage without them. The entities still building stay queued and move to the
 * front, in their order, with no new array; a slot that waits no more (its entity left) is dropped. One set lookup
 * per slot, and only after world's membership version moved.
 *
 * @param sctx - Domain context of the sync module.
 */
function releaseAside(sctx: SyncCtx): void {
  const aside = sctx.ctx.state.sync.aside;
  const projection = sctx.ctx.deps.world.projection;
  let kept = 0;

  for (let index = aside.head; index < aside.count; index += 1) {
    const entity = aside.entities[index] ?? 0;

    if (!aside.waiting.has(entity)) continue;

    if (projection.isBuilding(entity)) {
      aside.entities[kept] = entity;
      kept += 1;
    } else {
      toLivePass(sctx, entity);
    }
  }

  aside.head = 0;
  aside.count = kept;
}

/**
 * The swap: once the membership version moved, every held top that is no longer building is attached in one block, in
 * the order it was made (parents first), and sorted by the rule of the layer list the pass has just applied: the tops
 * of a committed scene build, a warm window world shows. The tops still building (a window at rest, a scene still
 * being built) stay held and move to the front of the list, in their order, with no new array; a slot whose view went
 * (a discard, a view that left) or hangs elsewhere by now is dropped. The views of an ended build still queued aside
 * go to `added`, for this same pass: the scene or the window is whole in the frame it is attached. The version is
 * stored, so the next scan waits for its next move. Called by the pass right after `syncLayers`, before it builds
 * `added`.
 *
 * @param sctx - Domain context of the sync module.
 */
export function attachHeld(sctx: SyncCtx): void {
  if (!heldWaiting(sctx)) return;

  const state = sctx.ctx.state.sync;
  const held = state.heldViews;
  const projection = sctx.ctx.deps.world.projection;
  let kept = 0;

  for (let index = 0; index < held.count; index += 1) {
    const entity = held.entities[index] ?? 0;
    const view = state.views.get(entity);

    if (view === undefined || !view.held) continue;

    if (projection.isBuilding(entity)) {
      held.entities[kept] = entity;
      kept += 1;
      continue;
    }

    view.held = false;
    attach(sctx, entity, view);
    resort(sctx, entity, view);
  }

  // A build ended: the dev check may name the next one.
  if (kept !== held.count) held.reported = false;

  releaseAside(sctx);
  held.count = kept;
  held.version = projection.membershipVersion();
}

/**
 * Tells whether an entity of a set belongs to the running build.
 *
 * @param sctx - Domain context of the sync module.
 * @param entities - The set.
 * @returns True when one does.
 */
function holdsBuilding(sctx: SyncCtx, entities: ReadonlySet<Entity>): boolean {
  const projection = sctx.ctx.deps.world.projection;

  for (const entity of entities) if (projection.isBuilding(entity)) return true;

  return false;
}

/**
 * The renderer's part of `world.projection.built()`, registered with `onBuild`: no building entity waits in `added`
 * or in the aside queue for its view. True while the renderer draws nothing.
 *
 * @param sctx - Domain context of the sync module.
 * @returns True when the renderer holds the swap back no longer.
 */
export function buildReady(sctx: SyncCtx): boolean {
  const state = sctx.ctx.state.sync;

  if (state.root === undefined) return true;
  if (state.aside.head < state.aside.count) return false;

  return state.added.size === 0 || !holdsBuilding(sctx, state.added);
}

/**
 * The render phase's half of a scene build (the body of `SyncInternal.takeBuildWork`): reads and clears the count of the
 * views the pass made aside in this frame. A field read and no allocation.
 *
 * @param aside - The aside queue.
 * @returns True when the pass made views of the build: the frame did load work.
 */
export function takeBuildWork(aside: AsideQueue): boolean {
  const made = aside.made > 0;

  aside.made = 0;

  return made;
}
