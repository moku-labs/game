/**
 * @file input plugin — who is under the finger. Every lookup goes through `renderer.sync.hitTest`,
 * which answers `undefined` without a DOM, and every accept function refuses a view that is
 * already playing its exit. A trace takes a cell only inside a circle smaller than its box.
 */
import { localPoseOf } from "../renderer/sync/pose";
import { Exiting } from "../world/ecs/define";
import type { Entity } from "../world/types";
import {
  Draggable,
  DropTarget,
  Pressable,
  Swipeable,
  Tappable,
  Touchable,
  Traceable
} from "./components";
import type { InputCtx, Point, Target } from "./types";

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
 * Tells whether a view takes a press: it carries one of the five gesture components or the
 * `Touchable` tag, and is not on its way out. A view with only a `DropTarget` takes no press.
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
    ecs.has(entity, Swipeable) ||
    ecs.has(entity, Traceable) ||
    ecs.has(entity, Touchable)
  );
}

/**
 * Builds the accept function of a drop: a `DropTarget` that is not in the hand and not on its
 * way out. The whole stack is excluded, not only the held view: a carried view hangs under the
 * held one and is hit before it where they overlap.
 *
 * @param ctx - Domain context of the input plugin.
 * @param excluded - The held view and every view it carries; none takes the drop.
 * @returns The accept function `hitTest` calls per candidate.
 */
export function acceptDrop(
  ctx: InputCtx,
  excluded: readonly Entity[]
): (entity: Entity) => boolean {
  const { ecs } = ctx.deps.world;

  return entity =>
    !excluded.includes(entity) && !ecs.has(entity, Exiting) && ecs.has(entity, DropTarget);
}

/**
 * Builds the accept function of a trace sample: a `Traceable` that is not on its way out and
 * holds the point inside its inset circle. The circle sits at the centre of the very box
 * `hitTest` tests, with a radius of `traceInset` times the box's short side, so a diagonal drawn
 * off the centre line cuts no corner of a neighbour. The point is brought into the cell's own
 * units through its `Transform` and `Parent` chain, as the hit test does.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - The sample, in reference units.
 * @returns The accept function `hitTest` calls per candidate.
 */
export function acceptTrace(ctx: InputCtx, point: Point): (entity: Entity) => boolean {
  const { ecs } = ctx.deps.world;

  return entity => {
    if (!ecs.has(entity, Traceable) || ecs.has(entity, Exiting)) return false;

    const box = ctx.deps.renderer.sync.hitBoxOf(entity);

    if (box === undefined) return false;

    const local = localPoseOf(ecs, entity, {
      x: point.x,
      y: point.y,
      rotation: 0,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });
    const radius = ctx.config.traceInset * Math.min(box.width, box.height);

    return (
      Math.hypot(local.x - (box.x + box.width / 2), local.y - (box.y + box.height / 2)) <= radius
    );
  };
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
 * @param excluded - The held view and every view it carries, which are skipped.
 * @returns The entity, or `undefined` when the finger is over nothing.
 */
export function findDropTarget(
  ctx: InputCtx,
  x: number,
  y: number,
  excluded: readonly Entity[]
): Entity | undefined {
  return ctx.deps.renderer.sync.hitTest(x, y, acceptDrop(ctx, excluded));
}

/**
 * The topmost trace cell whose inset circle holds a sample.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - The sample, in reference units.
 * @returns The cell, or `undefined` over a gap.
 */
export function findTraced(ctx: InputCtx, point: Point): Entity | undefined {
  return ctx.deps.renderer.sync.hitTest(point.x, point.y, acceptTrace(ctx, point));
}
