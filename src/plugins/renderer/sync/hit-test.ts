/**
 * @file renderer/sync — the hit test. Pure component math: Pixi updates its world matrices at
 * render time, one frame after the input phase asks.
 */
import type { Entity } from "../../world/types";
import { Parent, Shape, Transform, type TransformValue } from "../components";
import type { PixiContainer, Point } from "../types";
import type { HitBox, SyncCtx } from "./types";

/** How deep a parent chain or a container tree is followed. */
const MAX_DEPTH = 32;

/** Below this effective alpha a view is treated as not there. */
const MIN_ALPHA = 0.01;

/**
 * Moves a point out of one transform, into the local space below it.
 *
 * @param point - The point in the space above.
 * @param value - The transform to undo.
 * @returns The same point, one space lower.
 * @example
 * ```ts
 * untransform({ x: 20, y: 10 }, { x: 10, y: 10, rotation: 0, scale: 2 }); // { x: 5, y: 0 }
 * ```
 */
function untransform(point: Point, value: Readonly<TransformValue>): Point {
  const dx = point.x - value.x;
  const dy = point.y - value.y;
  const cos = Math.cos(-value.rotation);
  const sin = Math.sin(-value.rotation);
  const scale = value.scale === 0 ? 1 : value.scale;

  return { x: (dx * cos - dy * sin) / scale, y: (dx * sin + dy * cos) / scale };
}

/**
 * Walks the `Parent` chain of an entity and brings a reference point into its local space.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity whose box is tested.
 * @param x - Reference x.
 * @param y - Reference y.
 * @returns The point in the entity's own space.
 */
function localPoint(sctx: SyncCtx, entity: Entity, x: number, y: number): Point {
  const ecs = sctx.ctx.deps.world.ecs;
  const chain: Array<Readonly<TransformValue>> = [];
  let current = entity;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    chain.push(ecs.get(current, Transform) ?? Transform.defaults);

    const parent = ecs.get(current, Parent)?.entity ?? 0;

    if (parent === 0 || parent === current) break;

    current = parent;
  }

  let point: Point = { x, y };

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const value = chain[index];

    if (value !== undefined) point = untransform(point, value);
  }

  return point;
}

/**
 * Tells whether a local point is inside a hit box.
 *
 * @param box - The box, in local units.
 * @param point - The point, in local units.
 * @returns True when the box holds the point.
 * @example
 * ```ts
 * inBox({ x: -32, y: -32, width: 64, height: 64 }, { x: 0, y: 0 }); // true
 * ```
 */
function inBox(box: HitBox, point: Point): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/**
 * Tells whether a clipping ancestor hides the point: a `Shape` with `clip: true` shows its
 * children only inside its own rectangle, so a point outside it reaches nothing below.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity being tested.
 * @param x - Reference x.
 * @param y - Reference y.
 * @returns True when the point falls outside a clipping ancestor.
 */
function clippedOut(sctx: SyncCtx, entity: Entity, x: number, y: number): boolean {
  const ecs = sctx.ctx.deps.world.ecs;
  let current = ecs.get(entity, Parent)?.entity ?? 0;

  for (let depth = 0; depth < MAX_DEPTH && current !== 0; depth += 1) {
    const shape = ecs.get(current, Shape);

    if (shape?.clip === true) {
      const box: HitBox = { x: 0, y: 0, width: shape.w, height: shape.h };

      if (!inBox(box, localPoint(sctx, current, x, y))) return true;
    }

    const parent = ecs.get(current, Parent)?.entity ?? 0;

    if (parent === current) break;

    current = parent;
  }

  return false;
}

/**
 * The alpha a display object really draws with, and 0 when anything on its way to the root is
 * hidden or when it hangs in no tree at all.
 *
 * @param object - The display object.
 * @param root - The root container of `sync`.
 * @returns The effective alpha.
 */
function effectiveAlpha(object: PixiContainer, root: PixiContainer): number {
  let alpha = 1;
  let current: PixiContainer | undefined = object;

  for (let depth = 0; depth < MAX_DEPTH && current !== undefined; depth += 1) {
    if (current === root) return alpha;
    if (!current.visible) return 0;

    alpha *= current.alpha;
    current = current.parent ?? undefined;
  }

  return 0;
}

/**
 * Collects the children of a container in draw order from the top: by `zIndex` descending, then
 * by insertion descending. The children of a wrapper come before the wrapper's own visual.
 *
 * @param container - The container to walk.
 * @param out - Where the result is collected.
 * @param depth - How deep the walk already is.
 * @returns The same array.
 */
function topFirst(container: PixiContainer, out: PixiContainer[], depth = 0): PixiContainer[] {
  if (depth >= MAX_DEPTH) return out;

  const ordered = container.children.toSorted((left, right) => left.zIndex - right.zIndex);

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const child = ordered[index];

    if (child === undefined) continue;

    if (child.children.length > 0) topFirst(child, out, depth + 1);
    out.push(child);
  }

  return out;
}

/**
 * The topmost accepted entity inside one layer container.
 *
 * @param sctx - Domain context of the sync module.
 * @param container - The layer container.
 * @param root - The root container of `sync`.
 * @param point - The reference point.
 * @param accept - The filter of the caller.
 * @returns The entity, or `undefined`.
 */
function pickIn(
  sctx: SyncCtx,
  container: PixiContainer,
  root: PixiContainer,
  point: Point,
  accept: (entity: Entity) => boolean
): Entity | undefined {
  const state = sctx.ctx.state.sync;

  for (const object of topFirst(container, [])) {
    const entity = state.entityOf.get(object);
    const view = entity === undefined ? undefined : state.views.get(entity);

    if (entity === undefined || view === undefined) continue;
    if (effectiveAlpha(object, root) <= MIN_ALPHA) continue;
    if (!inBox(view.hitBox, localPoint(sctx, entity, point.x, point.y))) continue;
    if (clippedOut(sctx, entity, point.x, point.y)) continue;
    if (accept(entity)) return entity;
  }

  return undefined;
}

/**
 * The topmost entity under a reference point that the caller accepts.
 *
 * @param sctx - Domain context of the sync module.
 * @param x - Reference x.
 * @param y - Reference y.
 * @param accept - The filter of the caller.
 * @returns The entity, or `undefined`.
 */
export function hitTest(
  sctx: SyncCtx,
  x: number,
  y: number,
  accept: (entity: Entity) => boolean
): Entity | undefined {
  const state = sctx.ctx.state.sync;
  const root = state.root;
  const list = state.layerList;

  if (root === undefined || list === undefined) return undefined;

  for (let index = list.length - 1; index >= 0; index -= 1) {
    const name = list[index]?.name;
    const container = name === undefined ? undefined : state.layers.get(name)?.container;

    if (container === undefined) continue;

    const found = pickIn(sctx, container, root, { x, y }, accept);

    if (found !== undefined) return found;
  }

  return undefined;
}
