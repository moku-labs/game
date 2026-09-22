/**
 * @file input plugin — the drag: grab, move, hover, release and abort. The engine owns the
 * lifting, the muted position and the way home; a game writes no drag code. A view with a
 * `Parent` is carried in root space: it leaves its parent at the grab and is hung back under it,
 * where the finger left it, at the release.
 */
import { Parent, Transform } from "../renderer/components";
import { localPoseOf, parentOf, rootPoseOf } from "../renderer/sync/pose";
import type { Entity } from "../world/types";
import { dropAnswer, submit } from "./answers";
import { Draggable, DropTarget, Held, Hovered } from "./components";
import { findDropTarget } from "./hit";
import type { InputCtx, Point } from "./types";

/** The fields the finger owns on a view that keeps its place in the scene. */
const FINGER_FIELDS = ["x", "y"];

/**
 * The fields the finger owns on a view it took out of its parent: every number of the root pose
 * it wrote, so no motion writes a parent-local value into it while it is carried.
 */
const ROOT_POSE_FIELDS = ["x", "y", "rotation", "scale"];

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
 * Takes a parented view out of its parent for the drag. The parent is remembered, the root pose
 * is written into the `Transform` and the `Parent` goes, so the finger moves the view 1:1 and
 * `lift` reaches the lift layer. A view with no parent, or no `Transform` to take the pose, stays.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The view the finger picked up.
 * @returns True when the view left a parent.
 */
function unparent(ctx: InputCtx, entity: Entity): boolean {
  const { ecs } = ctx.deps.world;
  const parent = parentOf(ecs, entity);

  if (parent === 0 || !ecs.has(entity, Transform)) return false;

  const root = rootPoseOf(ecs, entity);

  ctx.state.parent = parent;
  ecs.remove(entity, Parent);
  ecs.set(entity, Transform, root);

  return true;
}

/**
 * Hangs a view that left its parent for the drag back under it, at the local pose that keeps it
 * where the finger left it, so the motion home starts under the finger. A parent with no
 * `Transform` left the world meanwhile: the view keeps its root pose. A view that is gone is
 * forgotten.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The view that was carried.
 */
function reparent(ctx: InputCtx, entity: Entity): void {
  const { parent } = ctx.state;
  const { ecs } = ctx.deps.world;

  ctx.state.parent = undefined;
  if (parent === undefined || !ecs.has(entity, Transform) || !ecs.has(parent, Transform)) return;

  const local = localPoseOf(ecs, parent, rootPoseOf(ecs, entity));

  ecs.add(entity, Parent({ entity: parent }));
  ecs.set(entity, Transform, local);
}

/**
 * Takes a view into the hand: it is tagged, it leaves its parent, its pose is muted so no motion
 * writes it, it is lifted above its neighbours, and the gate learns that a pointer is down. The
 * offset to the finger is read last, so a view that is still sliding from an earlier motion is
 * picked up where it is, with no jump.
 *
 * @param ctx - Domain context of the input plugin.
 * @param entity - The view under the finger.
 * @param point - Where the finger is, in reference units.
 */
export function grab(ctx: InputCtx, entity: Entity, point: Point): void {
  const { ecs, projection } = ctx.deps.world;

  ecs.tag(entity, Held);

  const fields = unparent(ctx, entity) ? ROOT_POSE_FIELDS : FINGER_FIELDS;

  ctx.state.unmute = projection.mute(entity, Transform, fields);
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
 * grab. A view that left its parent is hung back under it first, so a commit that follows the
 * answer moves it from under the finger. Then the answer goes to the gate, and always, in this
 * order: the mute is lifted so the settle motion can write the position again, the view is sent
 * home, the lift is released — on a view that still moves that takes effect when its last motion
 * ends, so a settling view flies home above its neighbours — the tags go, and the gate learns the
 * pointer is up.
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

  reparent(ctx, entity);

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
 * mute is lifted, which is safe after the entity is gone, a view that plays its exit is hung back
 * under the parent it left, and the gate learns the pointer is up. No answer, no settle and no
 * `lift(false)`: the exit motion and its layer belong to the projection.
 *
 * @param ctx - Domain context of the input plugin.
 */
export function abortDrag(ctx: InputCtx): void {
  const { entity } = ctx.state;
  const { ecs } = ctx.deps.world;

  ctx.state.unmute?.();
  ctx.state.unmute = undefined;
  if (entity !== undefined) reparent(ctx, entity);
  if (entity !== undefined && ecs.has(entity, Held)) ecs.untag(entity, Held);
  clearHover(ctx);
  ctx.deps.flow.gate.pointer(false);
}
