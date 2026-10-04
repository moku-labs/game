/**
 * @file renderer/sync — where a view is: its hit box in its own units, its bounds in reference
 * units, and the layer it is drawn in. Pure component math over `world.ecs.get`, the same math the
 * hit test walks, so a box the doors report is the box a click reaches.
 */
import { Layer } from "../../world/ecs/define";
import type { Entity } from "../../world/types";
import type { Point } from "../types";
import { isShown } from "./hit-test";
import { parentOf, rootPointOf } from "./pose";
import type { HitBox, SyncCtx, SyncState } from "./types";

/** How deep a parent chain is followed; deeper is treated as a loop. */
const MAX_DEPTH = 32;

/**
 * The four corners of a box, clockwise from the top-left one.
 *
 * @param box - The box.
 * @returns The corners.
 * @example
 * ```ts
 * cornersOf({ x: -32, y: -32, width: 64, height: 64 })[2]; // { x: 32, y: 32 }
 * ```
 */
function cornersOf(box: HitBox): Point[] {
  const right = box.x + box.width;
  const bottom = box.y + box.height;

  return [
    { x: box.x, y: box.y },
    { x: right, y: box.y },
    { x: right, y: bottom },
    { x: box.x, y: bottom }
  ];
}

/**
 * The axis-aligned box around some points.
 *
 * @param points - The points; at least one.
 * @returns The smallest box that holds them all.
 * @example
 * ```ts
 * boxAround([{ x: 0, y: 4 }, { x: 3, y: -1 }]); // { x: 0, y: -1, width: 3, height: 5 }
 * ```
 */
function boxAround(points: readonly Point[]): HitBox {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/**
 * The box `hitTest` tests for an entity's view, in its own units.
 *
 * @param state - The sync branch of the plugin state.
 * @param entity - The entity.
 * @returns A copy of the box, or `undefined` when the entity has no view.
 */
export function hitBoxOf(state: SyncState, entity: Entity): HitBox | undefined {
  const box = state.views.get(entity)?.hitBox;

  return box === undefined ? undefined : { ...box };
}

/**
 * Where a view is drawn, in reference units: the bounds of its hit box's corners brought through
 * the `Transform` and the `Parent` chain. Only a view the player can see has bounds.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @returns The bounds, or `undefined` for no view, a view hidden or not in the tree, and bounds
 *   without area.
 */
export function boundsOf(sctx: SyncCtx, entity: Entity): HitBox | undefined {
  const state = sctx.ctx.state.sync;
  const view = state.views.get(entity);
  const root = state.root;

  if (view === undefined || root === undefined || !isShown(view.object, root)) return undefined;

  const ecs = sctx.ctx.deps.world.ecs;
  const bounds = boxAround(cornersOf(view.hitBox).map(corner => rootPointOf(ecs, entity, corner)));

  return bounds.width > 0 && bounds.height > 0 ? bounds : undefined;
}

/**
 * The layer an entity is drawn in: the `Layer` of the root of its `Parent` chain.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @returns The layer name, or `undefined` when the root has no `Layer`.
 */
export function layerOf(sctx: SyncCtx, entity: Entity): string | undefined {
  const ecs = sctx.ctx.deps.world.ecs;
  let top = entity;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const parent = parentOf(ecs, top);

    if (parent === 0) break;

    top = parent;
  }

  return ecs.get(top, Layer)?.name;
}
