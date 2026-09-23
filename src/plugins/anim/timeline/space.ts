/**
 * @file anim/timeline — the space of a `tween` target. A step with `space: "root"` names where a
 * view lands in root space; this turns it into the local `Transform` under the view's parent when
 * the track starts, through `localPoseOf` of `renderer`. Pure: it only reads `world.ecs`.
 */
import { Transform, type TransformValue } from "../../renderer/components";
import { localPoseOf, parentOf, rootPoseOf } from "../../renderer/sync/pose";
import type { PoseReader } from "../../renderer/sync/types";
import type { AnyComponent } from "../../world/ecs/types";
import type { Entity } from "../../world/types";
import { asComponent } from "../components";

/** The fields of a `Transform` a root-space target is converted in. */
const POSE_FIELDS = ["x", "y", "rotation", "scale"] as const;

/**
 * Turns the root-space target of a tween into the local target under the entity's parent. A field
 * the step does not name is read from where the entity stands now and is not written, so a step
 * that names only `scale` leaves `x` and `y` alone. A component other than `Transform`, and an
 * entity without a parent, keep the target as it is.
 *
 * @param ecs - The world read, `world.ecs`.
 * @param entity - The entity the tween moves.
 * @param component - The component the tween drives.
 * @param to - The numeric target fields, in root space.
 * @returns The target fields in the space of the entity's parent.
 */
export function localTargetOf(
  ecs: PoseReader,
  entity: Entity,
  component: AnyComponent,
  to: Readonly<Record<string, number>>
): Record<string, number> {
  const local = { ...to };
  const parent = parentOf(ecs, entity);

  if (component !== asComponent(Transform) || parent === 0) return local;

  const now = rootPoseOf(ecs, entity);
  const root: TransformValue = {
    x: to.x ?? now.x,
    y: to.y ?? now.y,
    rotation: to.rotation ?? now.rotation,
    scale: to.scale ?? now.scale,
    pivot: now.pivot
  };
  const landed = localPoseOf(ecs, parent, root);

  for (const field of POSE_FIELDS) {
    if (to[field] !== undefined) local[field] = landed[field];
  }

  return local;
}
