/**
 * @file renderer/sync — the pose helpers: where an entity really is, in root (reference) space,
 * and the local pose that puts it there under a parent. Pure component math over `world.ecs.get`,
 * the same math the renderer draws with: `position` is where the `pivot` lands, and the pivot is
 * the local point the view turns and scales around.
 *
 * Engine-internal, not a root export. `input`, `anim` and `ui` import these two from this module
 * path (`../renderer/sync/pose`) and never walk the `Parent` chain themselves.
 */
import type { Entity } from "../../world/types";
import { Parent, Transform, type TransformValue } from "../components";
import type { Point } from "../types";
import type { PoseReader } from "./types";

/** How deep a parent chain is followed; deeper is treated as a loop. */
const MAX_DEPTH = 32;

/**
 * The parent an entity moves with.
 *
 * @param ecs - The world read.
 * @param entity - The entity.
 * @returns The parent entity, or `0` when it has none or names itself.
 */
export function parentOf(ecs: PoseReader, entity: Entity): Entity {
  const parent = ecs.get(entity, Parent)?.entity ?? 0;

  return parent === entity ? 0 : parent;
}

/**
 * A fresh copy of a pose, so a caller may change what it got without touching the world.
 *
 * @param pose - The pose to copy.
 * @returns The same numbers in new objects.
 * @example
 * ```ts
 * copyPose({ x: 1, y: 2, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }).pivot.x; // 0
 * ```
 */
function copyPose(pose: Readonly<TransformValue>): TransformValue {
  return {
    x: pose.x,
    y: pose.y,
    rotation: pose.rotation,
    scale: pose.scale,
    pivot: { x: pose.pivot.x, y: pose.pivot.y }
  };
}

/**
 * Moves a point out of the local space of a pose, into the space the pose sits in.
 *
 * @param pose - The pose whose local space the point is in.
 * @param point - The local point.
 * @returns The point one space higher.
 * @example
 * ```ts
 * applyPose({ x: 10, y: 0, rotation: 0, scale: 2, pivot: { x: 5, y: 0 } }, { x: 5, y: 1 });
 * // { x: 10, y: 2 }
 * ```
 */
function applyPose(pose: Readonly<TransformValue>, point: Point): Point {
  const cos = Math.cos(pose.rotation);
  const sin = Math.sin(pose.rotation);
  const dx = point.x - pose.pivot.x;
  const dy = point.y - pose.pivot.y;

  return {
    x: pose.x + pose.scale * (dx * cos - dy * sin),
    y: pose.y + pose.scale * (dx * sin + dy * cos)
  };
}

/**
 * Where an entity really is: its `Transform` composed through the `Parent` chain, every pivot on
 * the way applied. The answer keeps the entity's own pivot, so it can be written straight into the
 * `Transform` of an entity without a parent and the view does not move.
 *
 * @param ecs - The world read, `world.ecs`.
 * @param entity - The entity to place.
 * @param own - A pose to use in place of the entity's own `Transform`, such as its rest pose.
 * @returns The pose in root space. An entity without a `Transform` sits at the identity pose.
 * @example
 * ```ts
 * // `input` lifts a board cell out of its slot: the slot sits at (40, 60) scaled 0.5,
 * // the cell at (100, 200) inside it.
 * rootPoseOf(ctx.require(worldPlugin).ecs, cell);
 * // { x: 90, y: 160, rotation: 0, scale: 0.5, pivot: { x: 0, y: 0 } }
 * ```
 */
export function rootPoseOf(
  ecs: PoseReader,
  entity: Entity,
  own?: Readonly<TransformValue>
): TransformValue {
  const pose = copyPose(own ?? ecs.get(entity, Transform) ?? Transform.defaults);
  let current = entity;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const parent = parentOf(ecs, current);

    if (parent === 0) break;

    const above = ecs.get(parent, Transform) ?? Transform.defaults;
    const landed = applyPose(above, pose);

    pose.x = landed.x;
    pose.y = landed.y;
    pose.rotation += above.rotation;
    pose.scale *= above.scale;
    current = parent;
  }

  return pose;
}

/**
 * The inverse of `rootPoseOf`: the local pose under `parent` that puts an entity at a root pose.
 * The pivot is kept, as it is a local point of the entity itself.
 *
 * @param ecs - The world read, `world.ecs`.
 * @param parent - The entity to hang under; `0` for none, which answers the root pose itself.
 * @param root - The pose in root space.
 * @returns The local pose. A parent collapsed to scale 0 counts as scale 1, so the answer stays
 *   finite.
 * @example
 * ```ts
 * // `input` drops the cell back into the slot at (40, 60) scaled 0.5, where the finger left it.
 * localPoseOf(ctx.require(worldPlugin).ecs, slot, {
 *   x: 90, y: 160, rotation: 0, scale: 0.5, pivot: { x: 0, y: 0 }
 * });
 * // { x: 100, y: 200, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }
 * ```
 */
export function localPoseOf(
  ecs: PoseReader,
  parent: Entity,
  root: Readonly<TransformValue>
): TransformValue {
  if (parent === 0) return copyPose(root);

  const above = rootPoseOf(ecs, parent);
  const scale = above.scale === 0 ? 1 : above.scale;
  const cos = Math.cos(-above.rotation);
  const sin = Math.sin(-above.rotation);
  const dx = root.x - above.x;
  const dy = root.y - above.y;

  return {
    x: above.pivot.x + (dx * cos - dy * sin) / scale,
    y: above.pivot.y + (dx * sin + dy * cos) / scale,
    rotation: root.rotation - above.rotation,
    scale: root.scale / scale,
    pivot: { x: root.pivot.x, y: root.pivot.y }
  };
}
