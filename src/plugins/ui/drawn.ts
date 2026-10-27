/**
 * @file ui plugin — where a target is drawn, in screen reference units: the one resolver the
 * `<anchor>` pass and `app.ui.rectOf` share. A target's local box goes through its root pose, the
 * `Transform` of every entity on its way up composed, so a scroll's offset, a fit, a slot and the
 * motion of an ancestor move it. Axis-aligned: the rotation is left out. A ui element spawned in
 * this frame has no `Transform` until the flush of the phase: its rest pose stands in, so it is
 * found in the frame it is laid out. The frame path allocates nothing: every answer is written into
 * the caller's objects, and no fractional number crosses a call. `rectOf` answers a new rect.
 */
import { NineSlice, Shape, Sprite, Transform, type TransformValue } from "../renderer/components";
import { parentOf } from "../renderer/sync/pose";
import { Text } from "../text/components";
import { Exiting } from "../world/ecs/define";
import type { AnchorTarget } from "../world/projection/types";
import type { EcsApi, Entity, ProjectionApi } from "../world/types";
import type { Element, Root } from "./jsx/types";
import type { Rect } from "./layout/types";
import type { UiCtx } from "./types";

/** How deep a chain is followed; deeper is treated as a loop. */
const MAX_DEPTH = 32;

/** The alpha a target is drawn at below which it counts as not shown, as the hit test reads it. */
const MIN_ALPHA = 0.01;

/**
 * What the resolver reads: the world, the projection keys, and the elements and roots of `ui`, so
 * an element of this frame is placed by its rest pose and its root's slot.
 */
export type DrawnReader = {
  readonly ecs: Pick<EcsApi, "get" | "has">;
  readonly projection: Pick<ProjectionApi, "entityOf" | "isBuilding">;
  readonly elements: ReadonlyMap<Entity, Element>;
  readonly roots: ReadonlyMap<Entity, Root>;
  readonly exiting: ReadonlySet<Entity>;
};

/**
 * The reader of a running `ui`, over its world and its own state.
 *
 * @param ctx - Domain context of the ui plugin.
 * @returns The reader; it holds the live maps, so it stays current.
 */
export function readerOf(ctx: UiCtx): DrawnReader {
  return {
    ecs: ctx.deps.world.ecs,
    projection: ctx.deps.world.projection,
    elements: ctx.state.jsx.elements,
    roots: ctx.state.jsx.roots,
    exiting: ctx.state.jsx.exiting
  };
}

/**
 * The entity an entity is drawn under: the parent of a ui element, the slot of a root element laid
 * out in one, the `Parent` of any other view.
 *
 * @param reader - What the resolver reads.
 * @param entity - The entity.
 * @returns The entity above it, or 0 when it hangs in its layer.
 */
export function upOf(reader: DrawnReader, entity: Entity): Entity {
  const element = reader.elements.get(entity);

  if (element === undefined) return parentOf(reader.ecs, entity);

  return element.parent ?? reader.roots.get(element.root)?.slot ?? 0;
}

/**
 * The pose an entity is drawn with: its `Transform`, or the rest pose of a ui element whose
 * `Transform` waits for the flush.
 *
 * @param reader - What the resolver reads.
 * @param entity - The entity.
 * @returns The pose, or `undefined` for a view with no `Transform`.
 */
function poseOf(reader: DrawnReader, entity: Entity): Readonly<TransformValue> | undefined {
  return reader.ecs.get(entity, Transform) ?? reader.elements.get(entity)?.rest;
}

/**
 * Writes where an entity really is: its pose composed through every entity it is drawn under,
 * the arithmetic of `rootPoseInto`, over `upOf`. The answer keeps the entity's own pivot.
 *
 * @param reader - What the resolver reads.
 * @param entity - The entity.
 * @param out - The pose to write, its `pivot` included.
 * @returns False for a view with no `Transform`: `out` is not written.
 */
export function drawnPoseInto(reader: DrawnReader, entity: Entity, out: TransformValue): boolean {
  const own = poseOf(reader, entity);

  if (own === undefined) return false;

  out.x = own.x;
  out.y = own.y;
  out.rotation = own.rotation;
  out.scale = own.scale;
  out.pivot.x = own.pivot.x;
  out.pivot.y = own.pivot.y;

  let current = entity;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const parent = upOf(reader, current);

    if (parent === 0) break;

    // Per frame: the step of `rootPoseInto`, in place.
    const above = poseOf(reader, parent) ?? Transform.defaults;
    const cos = Math.cos(above.rotation);
    const sin = Math.sin(above.rotation);
    const dx = out.x - above.pivot.x;
    const dy = out.y - above.pivot.y;

    out.x = above.x + above.scale * (dx * cos - dy * sin);
    out.y = above.y + above.scale * (dx * sin + dy * cos);
    out.rotation += above.rotation;
    out.scale *= above.scale;
    current = parent;
  }

  return true;
}

/**
 * Tells whether the player can see an entity: neither it nor anything it is drawn under is on its
 * way out, and the alphas of their visuals (`Shape`, `NineSlice`, `Sprite` or `Text`) multiply to
 * more than 0.01. The alpha of a visual fades the entity's children with it, as the renderer draws
 * it.
 *
 * @param reader - What the resolver reads.
 * @param entity - The entity.
 * @returns True when it is shown.
 */
function visible(reader: DrawnReader, entity: Entity): boolean {
  const ecs = reader.ecs;
  let alpha = 1;
  let current = entity;

  for (let depth = 0; depth < MAX_DEPTH && current !== 0; depth += 1) {
    if (reader.exiting.has(current) || ecs.has(current, Exiting)) return false;

    // The alpha of its own visual, read here: a fractional number a call returns is boxed.
    alpha *=
      ecs.get(current, Shape)?.alpha ??
      ecs.get(current, NineSlice)?.alpha ??
      ecs.get(current, Sprite)?.alpha ??
      ecs.get(current, Text)?.alpha ??
      1;
    current = upOf(reader, current);
  }

  return alpha > MIN_ALPHA;
}

/**
 * Moves a local box of an entity into root space, in place: moved by the pose, scaled around its
 * pivot, the rotation left out. The numbers stay in the rect: a fractional number handed to a call
 * is boxed.
 *
 * @param pose - The root pose of the entity.
 * @param out - The box in the entity's own units, written in root space.
 */
function toRoot(pose: Readonly<TransformValue>, out: Rect): void {
  out.x = pose.x + pose.scale * (out.x - pose.pivot.x);
  out.y = pose.y + pose.scale * (out.y - pose.pivot.y);
  out.w *= pose.scale;
  out.h *= pose.scale;
}

/**
 * Writes the box of an entity in its own units, by what it draws: the layout box of a ui element,
 * the panel of a nine-slice, the rectangle of a shape, the anchor box of a sprite.
 *
 * @param reader - What the resolver reads.
 * @param entity - The entity.
 * @param out - The rect written, its `x` and `y` at 0 when the call starts.
 * @returns False for an entity that draws none of them.
 */
function ownBoxInto(reader: DrawnReader, entity: Entity, out: Rect): boolean {
  const element = reader.elements.get(entity);

  if (element !== undefined) {
    out.w = element.rect.w;
    out.h = element.rect.h;

    return true;
  }

  const panel = reader.ecs.get(entity, NineSlice);

  if (panel !== undefined) {
    out.w = panel.width;
    out.h = panel.height;

    return true;
  }

  const shape = reader.ecs.get(entity, Shape);

  if (shape !== undefined) {
    out.w = shape.w;
    out.h = shape.h;

    return true;
  }

  const sprite = reader.ecs.get(entity, Sprite);

  if (sprite === undefined) return false;

  out.w = sprite.width;
  out.h = sprite.height;
  out.x = -sprite.anchor.x * sprite.width;
  out.y = -sprite.anchor.y * sprite.height;

  return true;
}

/**
 * Writes the box an entity draws in root space: its own box through its root pose.
 *
 * @param reader - What the resolver reads.
 * @param entity - The entity.
 * @param pose - Its root pose.
 * @param out - The rect written, in root space.
 * @returns False for an entity that draws no box.
 */
function localBoxInto(
  reader: DrawnReader,
  entity: Entity,
  pose: Readonly<TransformValue>,
  out: Rect
): boolean {
  out.x = 0;
  out.y = 0;

  if (!ownBoxInto(reader, entity, out)) return false;

  toRoot(pose, out);

  return true;
}

/**
 * Writes where an entity is drawn, in screen reference units, when it is shown. Not shown: the
 * entity belongs to a scene built aside, it or something it is drawn under is leaving, the alphas
 * on its way up multiply to 0.01 or less, it draws no box, or the box has no area.
 *
 * @param reader - What the resolver reads.
 * @param entity - The entity of the target.
 * @param out - The rect written.
 * @param pose - A pose the resolver writes on its way, kept by the caller.
 * @returns True when the target is shown and `out` holds its rect.
 */
export function drawnInto(
  reader: DrawnReader,
  entity: Entity,
  out: Rect,
  pose: TransformValue
): boolean {
  if (reader.projection.isBuilding(entity) || !visible(reader, entity)) return false;
  if (!drawnPoseInto(reader, entity, pose) || !localBoxInto(reader, entity, pose, out))
    return false;

  return out.w > 0 && out.h > 0;
}

/**
 * Grows a rect to hold another one.
 *
 * @param out - The rect grown in place.
 * @param part - The rect it must hold.
 */
export function unionInto(out: Rect, part: Readonly<Rect>): void {
  const right = Math.max(out.x + out.w, part.x + part.w);
  const bottom = Math.max(out.y + out.h, part.y + part.h);

  out.x = Math.min(out.x, part.x);
  out.y = Math.min(out.y, part.y);
  out.w = right - out.x;
  out.h = bottom - out.y;
}

/**
 * Tells a list of targets from one target.
 *
 * @param to - What `to` or `rectOf` was given.
 * @returns True for a list.
 * @example
 * ```ts
 * isTargetList([{ projection: "hud", key: "coins" }]); // true
 * ```
 */
export function isTargetList(
  to: AnchorTarget | readonly AnchorTarget[]
): to is readonly AnchorTarget[] {
  return Array.isArray(to);
}

/**
 * Writes the rect of one target or the bounding rect of the shown ones of a list.
 *
 * @param reader - What the resolver reads.
 * @param to - One target or a list of them.
 * @param out - The rect written.
 * @param scratch - The part and the pose the resolver writes on its way.
 * @param scratch.part - The rect of one target.
 * @param scratch.pose - The pose of one target.
 * @returns True when at least one target is shown.
 */
export function targetsInto(
  reader: DrawnReader,
  to: AnchorTarget | readonly AnchorTarget[],
  out: Rect,
  scratch: { part: Rect; pose: TransformValue }
): boolean {
  const list: readonly AnchorTarget[] = isTargetList(to) ? to : [to];
  let shown = false;

  for (const target of list) {
    const entity = reader.projection.entityOf(target.projection, target.key);

    if (entity === undefined || !drawnInto(reader, entity, scratch.part, scratch.pose)) continue;

    if (shown) {
      unionInto(out, scratch.part);
    } else {
      out.x = scratch.part.x;
      out.y = scratch.part.y;
      out.w = scratch.part.w;
      out.h = scratch.part.h;
      shown = true;
    }
  }

  return shown;
}

/**
 * Where a target, or the shown targets of a list, are drawn: `app.ui.rectOf`. Not a frame path:
 * every call answers a new rect.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param to - One target or a list of them.
 * @returns The rect in screen reference units, or `undefined` when no target is shown.
 */
export function rectOfTargets(
  ctx: UiCtx,
  to: AnchorTarget | readonly AnchorTarget[]
): Readonly<Rect> | undefined {
  const out: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const scratch = {
    part: { x: 0, y: 0, w: 0, h: 0 },
    pose: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }
  };

  return targetsInto(readerOf(ctx), to, out, scratch) ? out : undefined;
}
