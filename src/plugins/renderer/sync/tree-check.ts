/**
 * @file renderer/sync — the tree check of a dev or an agent build (spec 16 U2.5). The hit test maps a point through
 * the ECS `Parent` chain but finds its candidates in the Pixi tree, so the two must agree: every view a pass built,
 * hung again or took out of the orphans must hang under its parent's child container, or in its layer without a
 * parent. A view that does not is reported once, and a phone log names what would show as a press that misses.
 */
import { Layer } from "../../world/ecs/define";
import type { Entity } from "../../world/types";
import type { PixiContainer } from "../types";
import { layerContainer } from "./layers";
import { parentOf } from "./pose";
import type { SyncCtx } from "./types";

/**
 * The container a view must hang in by the ECS: its parent's child container (read, never created), or the container
 * of the layer it names.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity of the view.
 * @param parent - The entity its `Parent` names, 0 without one.
 * @returns The container, or `undefined` when the view hangs nowhere (an unknown layer, a parent that has no view).
 */
function expectedHostOf(sctx: SyncCtx, entity: Entity, parent: Entity): PixiContainer | undefined {
  const state = sctx.ctx.state.sync;

  if (parent === 0) {
    return layerContainer(state, sctx.ctx.deps.world.ecs.get(entity, Layer)?.name ?? "");
  }

  const view = state.views.get(parent);

  return view?.clipped ?? view?.wrapper;
}

/**
 * Checks where the views of the given entities hang and reports every one that hangs elsewhere than the ECS says,
 * once per entity. An orphan and a held view of a scene build (spec 31) hang nowhere on purpose and are skipped.
 *
 * @param sctx - Domain context of the sync module.
 * @param entities - The entities a pass built, hung again or took out of the orphans.
 */
export function checkTree(sctx: SyncCtx, entities: Iterable<Entity>): void {
  const state = sctx.ctx.state.sync;
  const ecs = sctx.ctx.deps.world.ecs;

  for (const entity of entities) {
    const view = state.views.get(entity);

    if (
      view === undefined ||
      view.held ||
      state.orphans.has(entity) ||
      state.mismatched.has(entity)
    ) {
      continue;
    }

    const parent = parentOf(ecs, entity);
    const host = (view.wrapper ?? view.object).parent;
    const expected = expectedHostOf(sctx, entity, parent);

    // A view that hangs nowhere is right when the ECS gives it nowhere to hang (an unknown layer).
    if (host === expected || (host === null && expected === undefined)) continue;

    state.mismatched.add(entity);
    sctx.ctx.log.error("renderer:tree-mismatch", { entity, parent });
  }
}
