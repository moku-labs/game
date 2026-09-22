/**
 * @file renderer/sync — the label every display object carries: what it is, which entity it
 * belongs to and which projected item it came from. Visible in PixiJS DevTools.
 */
import type { Entity } from "../../world/ecs/types";
import type { SyncCtx, ViewKind } from "./types";

/**
 * Builds the label of one view.
 *
 * @param sctx - Domain context of the sync module.
 * @param kind - Which component gave the entity its display object.
 * @param entity - The entity.
 * @returns `"Sprite#12 board.items:i5"`, or `"Sprite#12"` without a projection.
 */
export function labelOf(sctx: SyncCtx, kind: ViewKind, entity: Entity): string {
  const base = `${kind}#${entity}`;
  const key = sctx.ctx.deps.world.projection.keyOf(entity);

  return key === undefined ? base : `${base} ${key.projection}:${key.key}`;
}
