/**
 * @file anim plugin — the `Frames` component at run time: one loop per entity that carries it,
 * kept by two world hooks and stepped once per frame after the timelines and the tracks. A loop
 * writes `Sprite.texture` through `ecs.set` and stands aside while a running `frames` step holds
 * its entity. While the entity carries `Frames` the field is muted for the projection, so the end
 * of a projection motion does not correct it back to the rest key. It reuses the frame arithmetic
 * of the `frames` step.
 */
import { Sprite } from "../renderer/components";
import type { Entity } from "../world/types";
import { Frames } from "./components";
import { BEFORE_FIRST_FRAME } from "./timeline/cursor";
import { frameIndexAt } from "./timeline/frames";
import type { AnimCtx, FrameLoop, FramesValue, State } from "./types";

/**
 * A loop that has consumed no time and written nothing.
 *
 * @param keys - The keys array the loop plays, kept for the restart check.
 * @returns The loop record, before its first key.
 * @example
 * ```ts
 * freshLoop(["c0", "c1"]); // { keys: ["c0", "c1"], elapsed: 0, index: -1, written: false }
 * ```
 */
function freshLoop(keys: readonly string[]): FrameLoop {
  return { keys, elapsed: 0, index: BEFORE_FIRST_FRAME, written: false };
}

/**
 * Gives `Sprite.texture` of an entity to its loop: mutes the field for the projection, once per
 * entity. A no-op for an entity that is muted already.
 *
 * @param actx - Domain context of the anim plugin.
 * @param entity - The entity that carries `Frames`.
 */
function ownTexture(actx: AnimCtx, entity: Entity): void {
  const mutes = actx.state.frameMutes;

  if (mutes.has(entity)) return;

  mutes.set(entity, actx.deps.world.projection.mute(entity, Sprite, ["texture"]));
}

/**
 * Hands `Sprite.texture` of an entity back to the projection. A no-op for an entity that is not
 * muted.
 *
 * @param state - The plugin state.
 * @param entity - The entity that lost `Frames` or left.
 */
function releaseTexture(state: State, entity: Entity): void {
  state.frameMutes.get(entity)?.();
  state.frameMutes.delete(entity);
}

/**
 * Opens the loop table: a loop for every entity that gets `Frames` from now on, none for an
 * entity that loses it (`onRemoved` fires on `ecs.remove` and on despawn alike), and a loop for
 * every entity that carries it already. Each loop owns `Sprite.texture` of its entity while it
 * lives.
 *
 * @param actx - Domain context of the anim plugin.
 */
export function openFrameLoops(actx: AnimCtx): void {
  const { ecs } = actx.deps.world;
  const loops = actx.state.frameLoops;

  actx.state.offFrames.push(
    ecs.onAdded(Frames, (entity, value) => {
      loops.set(entity, freshLoop(value.keys));
      ownTexture(actx, entity);
    }),
    ecs.onRemoved(Frames, entity => {
      loops.delete(entity);
      releaseTexture(actx.state, entity);
    })
  );

  for (const [entity, value] of ecs.query(Frames)) {
    if (!loops.has(entity)) loops.set(entity, freshLoop(value.keys));

    ownTexture(actx, entity);
  }
}

/**
 * Removes the two world hooks, hands every muted `Sprite.texture` back to the projection and
 * empties the tables. The teardown runs it after `finishAll` released every hold.
 *
 * @param state - The plugin state.
 */
export function closeFrameLoops(state: State): void {
  for (const off of state.offFrames.splice(0)) off();
  for (const release of state.frameMutes.values()) release();

  state.frameMutes.clear();

  state.frameLoops.clear();
  state.framesHeld.clear();
}

/**
 * Counts one more running `frames` step on an entity.
 *
 * @param state - The plugin state.
 * @param entity - The entity the step writes.
 */
export function holdFrames(state: State, entity: Entity): void {
  state.framesHeld.set(entity, (state.framesHeld.get(entity) ?? 0) + 1);
}

/**
 * Counts one running `frames` step on an entity less. At zero the entry goes and the loop of the
 * entity owes its current key again, so the sprite does not keep the step's last key.
 *
 * @param state - The plugin state.
 * @param entity - The entity the step wrote.
 */
export function releaseFrames(state: State, entity: Entity): void {
  const count = (state.framesHeld.get(entity) ?? 0) - 1;

  if (count > 0) {
    state.framesHeld.set(entity, count);

    return;
  }

  state.framesHeld.delete(entity);

  const loop = state.frameLoops.get(entity);

  if (loop !== undefined) loop.written = false;
}

/**
 * Writes the key a loop landed on, unless a `frames` step holds the entity or it has no `Sprite`
 * yet. A skipped write is owed: the loop tries again on its next step.
 *
 * @param actx - Domain context of the anim plugin.
 * @param entity - The entity of the loop.
 * @param loop - The loop.
 * @param key - The key at the loop's index.
 */
function writeLoopKey(actx: AnimCtx, entity: Entity, loop: FrameLoop, key: string): void {
  const { ecs } = actx.deps.world;
  const held = (actx.state.framesHeld.get(entity) ?? 0) > 0;

  if (held || !ecs.has(entity, Sprite)) {
    loop.written = false;

    return;
  }

  ecs.set(entity, Sprite, { texture: key });
  loop.written = true;
}

/**
 * Steps one loop. A new `keys` array restarts it; the same array keeps its phase, and so does a
 * change of `fps`, `loop` or `playing`. The clock stands while `playing` is false and while
 * reduced motion is on, so the sprite keeps the frame it shows and walks on from it later.
 *
 * @param actx - Domain context of the anim plugin.
 * @param entity - The entity of the loop.
 * @param loop - The loop.
 * @param value - The `Frames` value the entity carries now.
 * @param deltaMs - Milliseconds of game time of the frame.
 */
function stepFrameLoop(
  actx: AnimCtx,
  entity: Entity,
  loop: FrameLoop,
  value: Readonly<FramesValue>,
  deltaMs: number
): void {
  if (value.keys !== loop.keys) Object.assign(loop, freshLoop(value.keys));

  if (value.playing && !actx.state.reducedMotion) loop.elapsed += deltaMs;

  const index = frameIndexAt(value.keys, value.fps, value.loop, loop.elapsed);
  const key = value.keys[index];

  // An empty list has no key: nothing is written and the entry stays.
  if (key === undefined) return;

  const due = index !== loop.index || !loop.written;

  loop.index = index;

  if (due) writeLoopKey(actx, entity, loop, key);
}

/**
 * Steps every `Frames` loop by the frame's delta. Runs in world mode `"live"` only, after the
 * timelines and the tracks, so a `frames` step that started in this frame holds its entity
 * already. An entity that lost `Frames` leaves the table here too, and its texture goes back to
 * the projection.
 *
 * @param actx - Domain context of the anim plugin.
 * @param deltaMs - Milliseconds of game time of the frame.
 */
export function stepFrameLoops(actx: AnimCtx, deltaMs: number): void {
  const { ecs } = actx.deps.world;

  for (const [entity, loop] of actx.state.frameLoops) {
    const value = ecs.get(entity, Frames);

    if (value === undefined) {
      actx.state.frameLoops.delete(entity);
      releaseTexture(actx.state, entity);

      continue;
    }

    stepFrameLoop(actx, entity, loop, value, deltaMs);
  }
}
