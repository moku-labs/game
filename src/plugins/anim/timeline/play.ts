/**
 * @file anim/timeline — one running timeline: the bookkeeping around a cursor. It builds the step
 * tree once per play, counts `Animation` on the entities the tree names, hands out the
 * `PlayHandle` and ends the timeline exactly once, whichever way it ended, despawning every
 * entity its `spawn` steps made.
 */
import { Transform } from "../../renderer/components";
import { rootPoseOf } from "../../renderer/sync/pose";
import type { Entity } from "../../world/types";
import { countPlaying } from "../components";
import type {
  AnimationDefinition,
  AnimCtx,
  PlayHandle,
  Pose,
  SlotTags,
  SlotValues,
  Target
} from "../types";
import { advanceCursor, cancelCursor, createCursor, entitiesOf, finishCursor } from "./cursor";
import { assertUniqueSpawns } from "./spawn";
import type { CursorCtx, RunningTimeline, TimelineRuntime } from "./types";

/**
 * Resolves a target to an entity: a projection key through `world.projection.entityOf`, which
 * also answers for an element a plugin above registered, an entity as itself, and a spawned id
 * through the spawn table of the timeline that asks.
 *
 * @param actx - Domain context of the anim plugin.
 * @param target - The projection key, the entity or the spawned id.
 * @param spawned - The spawn table of the asking timeline; without one a spawned id resolves to
 *   nothing.
 * @returns The entity, or `undefined` when no live view, element or spawned entity holds it.
 */
export function resolveTarget(
  actx: AnimCtx,
  target: Target,
  spawned?: ReadonlyMap<string, Entity>
): Entity | undefined {
  if (typeof target === "number") return target;

  if ("spawned" in target) return spawned?.get(target.spawned);

  return actx.deps.world.projection.entityOf(target.projection, target.key);
}

/**
 * What `at(target)` answers: where the target rests in root space, its rest `Transform` composed
 * through the `Parent` chain by `rootPoseOf` of `renderer`. The rest pose is what the picture holds
 * whenever nothing animates the target; an entity nothing projects answers its current
 * `Transform`. Inside `build` no spawn step has run yet, so `at(spawned(id))` answers the identity
 * pose and one warning. A target nothing resolves gives the identity pose and one
 * warning, so a choreography over a screen that is not there plays on instead of throwing.
 *
 * @param actx - Domain context of the anim plugin.
 * @param target - The projection key, the entity or the spawned id to read.
 * @param spawned - The spawn table of the asking timeline.
 * @returns The root pose of the target.
 */
export function restPoseOf(
  actx: AnimCtx,
  target: Target,
  spawned?: ReadonlyMap<string, Entity>
): Pose {
  const entity = resolveTarget(actx, target, spawned);
  const { ecs, projection } = actx.deps.world;
  // The rest pose when the world recorded one; the live value for an entity nothing projects.
  const own =
    entity === undefined
      ? undefined
      : (projection.restOf(entity, Transform) ?? ecs.get(entity, Transform));

  if (entity === undefined || own === undefined) {
    actx.log.warn(
      "anim:target-missing",
      typeof target === "number" ? { entity: target } : { ...target }
    );

    return { x: 0, y: 0, rotation: 0, scale: 1 };
  }

  const root = rootPoseOf(ecs, entity, own);

  return { x: root.x, y: root.y, rotation: root.rotation, scale: root.scale };
}

/**
 * The resolver a timeline holds until the promise executor hands it the real one. It lives in its
 * own function because lint refuses an arrow that closes over nothing inside another function.
 */
function noResolver(): void {
  // Nothing to resolve yet: the promise executor replaces this in the same tick.
}

/**
 * Creates the empty spawn table of one play. It lives in its own non-exported function because
 * lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty map from spawn id to entity.
 */
function emptySpawnTable(): Map<string, Entity> {
  return new Map();
}

/**
 * What the cursor of one running timeline carries down its tree.
 *
 * @param rt - The timeline runtime.
 * @param running - The running timeline.
 * @returns The cursor context.
 */
function cursorCtxOf(rt: TimelineRuntime, running: RunningTimeline): CursorCtx {
  return { rt, animation: running.animation, marks: running.marks, spawned: running.spawned };
}

/**
 * Ends one timeline exactly once: it leaves the table, `Animation` is counted down on every
 * entity it named, every entity it spawned is despawned, `anim:finished` is emitted unless it was
 * cancelled, and `done` resolves.
 *
 * @param actx - Domain context of the anim plugin.
 * @param running - The running timeline.
 * @param finished - False when the timeline was cancelled: a cancel announces nothing.
 */
function endTimeline(actx: AnimCtx, running: RunningTimeline, finished: boolean): void {
  if (running.ended) return;

  running.ended = true;
  actx.state.timelines.delete(running.id);

  for (const entity of running.entities) countPlaying(actx.deps.world.ecs, entity, -1);

  // What the timeline spawned is its own: it goes with the timeline, before anyone hears the end.
  for (const entity of running.spawned.values()) actx.deps.world.ecs.despawn(entity);

  running.spawned.clear();

  if (finished) actx.emit("anim:finished", { animation: running.animation });

  running.resolve();
}

/**
 * Builds the step tree of an animation with the given targets and starts it. The build runs here,
 * once per play, so the same animation may play twice at once, each play with its own spawn table.
 *
 * @param actx - Domain context of the anim plugin.
 * @param rt - The timeline runtime.
 * @param definition - What `defineAnimation` returned.
 * @param slots - One target, or a list of targets, per declared slot.
 * @returns The handle of the running timeline.
 * @throws {Error} When the tree spawns one id twice; nothing has started then.
 */
export function startTimeline<Tags extends SlotTags>(
  actx: AnimCtx,
  rt: TimelineRuntime,
  definition: AnimationDefinition<Tags>,
  slots: SlotValues<Tags>
): PlayHandle {
  const spawned = emptySpawnTable();
  const step = definition.build(slots, {
    at: (target: Target): Pose => restPoseOf(actx, target, spawned)
  });

  assertUniqueSpawns(definition.id, step);

  const id = actx.state.nextId;

  actx.state.nextId += 1;

  const cursor = createCursor(step);
  const entities = entitiesOf(rt, step);

  for (const entity of entities) countPlaying(actx.deps.world.ecs, entity, 1);

  let settle = noResolver;
  const done = new Promise<void>(resolve => {
    settle = resolve;
  });
  const running: RunningTimeline = {
    id,
    animation: definition.id,
    cursor,
    marks: [],
    entities,
    spawned,
    resolve: (): void => settle(),
    ended: false
  };

  actx.state.timelines.set(id, running);
  rt.wake();

  return {
    finish: (): void => {
      if (running.ended) return;

      finishCursor(cursorCtxOf(rt, running), cursor);
      endTimeline(actx, running, true);
    },
    cancel: (): void => {
      if (running.ended) return;

      cancelCursor(cursorCtxOf(rt, running), cursor);
      endTimeline(actx, running, false);
    },
    active: (): boolean => !running.ended,
    done,
    marks: (): readonly string[] => [...running.marks]
  };
}

/**
 * Hands every running timeline the delta of the frame and ends the ones whose tree is through.
 *
 * @param actx - Domain context of the anim plugin.
 * @param rt - The timeline runtime.
 * @param deltaMs - Milliseconds of game time of the frame.
 */
export function advanceTimelines(actx: AnimCtx, rt: TimelineRuntime, deltaMs: number): void {
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const running of [...actx.state.timelines.values()]) {
    if (running.ended) continue;

    advanceCursor(cursorCtxOf(rt, running), running.cursor, deltaMs);
    if (running.cursor.ended) endTimeline(actx, running, true);
  }
}

/**
 * Ends every running timeline at its own end: the picture lands where the choreography meant it
 * to, the marks are jumped in tree order and every pending `done` resolves.
 *
 * @param actx - Domain context of the anim plugin.
 * @param rt - The timeline runtime.
 */
export function finishAllTimelines(actx: AnimCtx, rt: TimelineRuntime): void {
  // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
  for (const running of [...actx.state.timelines.values()]) {
    if (running.ended) continue;

    finishCursor(cursorCtxOf(rt, running), running.cursor);
    endTimeline(actx, running, true);
  }
}
