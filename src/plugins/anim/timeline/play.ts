/**
 * @file anim/timeline — one running timeline: the bookkeeping around a cursor. It builds the step
 * tree once per play, counts `Animation` on the entities the tree names, hands out the
 * `PlayHandle` and ends the timeline exactly once, whichever way it ended.
 */
import { Transform } from "../../renderer/components";
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
import type { CursorCtx, RunningTimeline, TimelineRuntime } from "./types";

/**
 * Resolves a target to an entity: a projection key through `world.projection.entityOf`, which
 * also answers for an element a plugin above registered, and an entity as itself.
 *
 * @param actx - Domain context of the anim plugin.
 * @param target - The projection key or the entity.
 * @returns The entity, or `undefined` when no live view or element holds that key.
 */
export function resolveTarget(actx: AnimCtx, target: Target): Entity | undefined {
  if (typeof target === "number") return target;

  return actx.deps.world.projection.entityOf(target.projection, target.key);
}

/**
 * What `at(target)` answers: the `Transform` the target rests at, which is what the picture holds
 * whenever nothing animates it. A target nothing resolves gives the identity pose and one
 * warning, so a choreography over a screen that is not there plays on instead of throwing.
 *
 * @param actx - Domain context of the anim plugin.
 * @param target - The projection key or the entity to read.
 * @returns The pose of the target.
 */
export function restPoseOf(actx: AnimCtx, target: Target): Pose {
  const entity = resolveTarget(actx, target);
  // The rest pose when the world recorded one; the live value for an entity nothing projects.
  const stored =
    entity === undefined
      ? undefined
      : (actx.deps.world.projection.restOf(entity, Transform) ??
        actx.deps.world.ecs.get(entity, Transform));

  if (stored === undefined) {
    actx.log.warn(
      "anim:target-missing",
      typeof target === "number" ? { entity: target } : { ...target }
    );

    return { x: 0, y: 0, rotation: 0, scale: 1 };
  }

  return { x: stored.x, y: stored.y, rotation: stored.rotation, scale: stored.scale };
}

/**
 * The resolver a timeline holds until the promise executor hands it the real one. It lives in its
 * own function because lint refuses an arrow that closes over nothing inside another function.
 */
function noResolver(): void {
  // Nothing to resolve yet: the promise executor replaces this in the same tick.
}

/**
 * What the cursor of one running timeline carries down its tree.
 *
 * @param rt - The timeline runtime.
 * @param running - The running timeline.
 * @returns The cursor context.
 */
function cursorCtxOf(rt: TimelineRuntime, running: RunningTimeline): CursorCtx {
  return { rt, animation: running.animation, marks: running.marks };
}

/**
 * Ends one timeline exactly once: it leaves the table, `Animation` is counted down on every
 * entity it named, `anim:finished` is emitted unless it was cancelled, and `done` resolves.
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

  if (finished) actx.emit("anim:finished", { animation: running.animation });

  running.resolve();
}

/**
 * Builds the step tree of an animation with the given targets and starts it. The build runs here,
 * once per play, so the same animation may play twice at once.
 *
 * @param actx - Domain context of the anim plugin.
 * @param rt - The timeline runtime.
 * @param definition - What `defineAnimation` returned.
 * @param slots - One target, or a list of targets, per declared slot.
 * @returns The handle of the running timeline.
 */
export function startTimeline<Tags extends SlotTags>(
  actx: AnimCtx,
  rt: TimelineRuntime,
  definition: AnimationDefinition<Tags>,
  slots: SlotValues<Tags>
): PlayHandle {
  const id = actx.state.nextId;

  actx.state.nextId += 1;

  const step = definition.build(slots, { at: (target: Target): Pose => restPoseOf(actx, target) });
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
