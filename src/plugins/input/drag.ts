/**
 * @file input plugin — the drag: grab, move, hover, release and abort. The engine owns the
 * lifting, the muted position and the way home; a game writes no drag code.
 */
import { Transform } from "../renderer/components";
import type { Entity } from "../world/types";
import { dropAnswer, submit } from "./answers";
import { Draggable, DropTarget, Held, Hovered } from "./components";
import { findDropTarget } from "./hit";
import type { InputCtx, Point } from "./types";

/**
 * Drops the hover tag the drag set, if any.
 *
 * @param ctx - Domain context of the input plugin.
 */
function clearHover(ctx: InputCtx): void {
  const { hovered } = ctx.state;

  if (hovered !== undefined) ctx.deps.world.ecs.untag(hovered, Hovered);
  ctx.state.hovered = undefined;
}

/**
 * Takes a view into the hand: it is tagged, its position is muted so no motion writes it, it is
 * lifted above its neighbours, and the gate learns that a pointer is down. The offset to the
 * finger is read last, so a view that is still sliding from an earlier motion is picked up where
 * it is, with no jump.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The view under the finger.
 * @param point - Where the finger is, in reference units.
 */
export function grab(ctx: InputCtx, entity: Entity, point: Point): void {
  const { ecs, projection } = ctx.deps.world;

  ecs.tag(entity, Held);
  ctx.state.unmute = projection.mute(entity, Transform, ["x", "y"]);
  projection.lift(entity, true);
  ctx.deps.flow.gate.pointer(true);

  const transform = ecs.get(entity, Transform);

  ctx.state.grabOffset = {
    x: (transform?.x ?? point.x) - point.x,
    y: (transform?.y ?? point.y) - point.y
  };
}

/**
 * Writes the position of the held view once per frame, from the last sample of that frame.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - Where the finger is, in reference units.
 */
export function moveHeld(ctx: InputCtx, point: Point): void {
  const { entity, grabOffset } = ctx.state;

  if (entity === undefined) return;

  ctx.deps.world.ecs.set(entity, Transform, {
    x: point.x + grabOffset.x,
    y: point.y + grabOffset.y
  });
}

/**
 * Moves the `Hovered` tag to the topmost drop target under the finger. At most one view carries
 * it, and never the view in the hand.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - Where the finger is, in reference units.
 */
export function moveHover(ctx: InputCtx, point: Point): void {
  const found = findDropTarget(ctx, point.x, point.y, ctx.state.entity);

  if (found === ctx.state.hovered) return;

  clearHover(ctx);
  ctx.state.hovered = found;
  if (found !== undefined) ctx.deps.world.ecs.tag(found, Hovered);
}

/**
 * Lets the view go. With a drop target under the finger both components are read NOW, not at the
 * grab, and the answer goes to the gate. Then always, in this order: the mute is lifted so the
 * settle motion can write the position again, the view is sent home when nothing took it, the
 * lift is released — on a view that still moves that takes effect when its last motion ends, so a
 * settling view flies home above its neighbours — the tags go, and the gate learns the pointer is up.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - Where the finger let go. Left out for a cancel, which has no target.
 * @returns Whether the gate took the drop answer.
 */
export function release(ctx: InputCtx, point?: Point): boolean {
  const { entity } = ctx.state;

  if (entity === undefined) return false;

  const { ecs, projection } = ctx.deps.world;
  const target = point === undefined ? undefined : findDropTarget(ctx, point.x, point.y, entity);
  const draggable = ecs.get(entity, Draggable);
  const dropTarget = target === undefined ? undefined : ecs.get(target, DropTarget);
  const accepted =
    draggable !== undefined &&
    dropTarget !== undefined &&
    submit(ctx, entity, dropAnswer(draggable, dropTarget));

  ctx.state.unmute?.();
  ctx.state.unmute = undefined;
  // Always home: an accepted answer may still be refused by the node with no state change. A
  // commit that follows retargets the view from where it is; an exit motion cancels the settle.
  projection.settle(entity);
  projection.lift(entity, false);
  ecs.untag(entity, Held);
  clearHover(ctx);
  ctx.deps.flow.gate.pointer(false);

  return accepted;
}

/**
 * Gives the drag up because the view left: a commit despawned it, or its exit is playing. The
 * mute is lifted, which is safe after the entity is gone, and the gate learns the pointer is up.
 * No answer, no settle and no `lift(false)`: the exit motion and its layer belong to the projection.
 *
 * @param ctx - Domain context of the input plugin.
 */
export function abortDrag(ctx: InputCtx): void {
  const { entity } = ctx.state;
  const { ecs } = ctx.deps.world;

  ctx.state.unmute?.();
  ctx.state.unmute = undefined;
  if (entity !== undefined && ecs.has(entity, Held)) ecs.untag(entity, Held);
  clearHover(ctx);
  ctx.deps.flow.gate.pointer(false);
}
