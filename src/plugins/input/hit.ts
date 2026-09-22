/**
 * @file input plugin — who is under the finger. Every lookup goes through `renderer.sync.hitTest`,
 * which answers `undefined` without a DOM, and every accept function refuses a view that is
 * already playing its exit.
 */
import { Exiting } from "../world/ecs/define";
import type { Entity } from "../world/ecs/types";
import { Draggable, DropTarget, Pressable, Swipeable, Tappable } from "./components";
import type { InputCtx, Target } from "./types";

/**
 * Resolves what `app.input.*` was pointed at. A `{ projection, key }` goes through
 * `world.projection.entityOf`, which answers for live views only, so a view in the despawn queue
 * is never addressed. Any other value is taken as an entity.
 *
 * @param ctx - Domain context of the input plugin.
 * @param target - The projection key of a live view, or an entity.
 * @returns The entity, or `undefined` when no live view carries that key.
 */
export function resolveTarget(ctx: InputCtx, target: Target): Entity | undefined {
  if (typeof target !== "object") return target;

  return ctx.deps.world.projection.entityOf(target.projection, target.key);
}

/**
 * Tells whether a view takes a press: it carries one of the four gesture components and is not on
 * its way out. A view with only a `DropTarget` takes no press.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The candidate under the finger.
 * @returns True when the press belongs to this view.
 */
export function acceptPress(ctx: InputCtx, entity: Entity): boolean {
  const { ecs } = ctx.deps.world;

  if (ecs.has(entity, Exiting)) return false;

  return (
    ecs.has(entity, Tappable) ||
    ecs.has(entity, Pressable) ||
    ecs.has(entity, Draggable) ||
    ecs.has(entity, Swipeable)
  );
}

/**
 * Builds the accept function of a drop: a `DropTarget` that is neither the carried view nor on
 * its way out.
 *
 * @param ctx - Domain context of the input plugin.
 * @param held - The carried view, which never takes its own drop.
 * @returns The accept function `hitTest` calls per candidate.
 */
export function acceptDrop(ctx: InputCtx, held: Entity | undefined): (entity: Entity) => boolean {
  const { ecs } = ctx.deps.world;

  return entity => entity !== held && !ecs.has(entity, Exiting) && ecs.has(entity, DropTarget);
}

/**
 * The topmost view that takes the press at a point.
 *
 * @param ctx - Domain context of the input plugin.
 * @param x - Reference x.
 * @param y - Reference y.
 * @returns The entity, or `undefined` when nothing was hit.
 */
export function findPressed(ctx: InputCtx, x: number, y: number): Entity | undefined {
  return ctx.deps.renderer.sync.hitTest(x, y, entity => acceptPress(ctx, entity));
}

/**
 * The topmost drop target at a point.
 *
 * @param ctx - Domain context of the input plugin.
 * @param x - Reference x.
 * @param y - Reference y.
 * @param held - The carried view, which is skipped.
 * @returns The entity, or `undefined` when the finger is over nothing.
 */
export function findDropTarget(
  ctx: InputCtx,
  x: number,
  y: number,
  held: Entity | undefined
): Entity | undefined {
  return ctx.deps.renderer.sync.hitTest(x, y, acceptDrop(ctx, held));
}
