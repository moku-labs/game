/**
 * @file renderer plugin — the renderer sources of the `/inspect` door: the frame counters, and what
 * lies under a point of the page. Production-safe: both only read.
 */
import { defineSource } from "../flow/doors/define";
import type { HeadlessApp } from "../flow/headless";
import { Layer } from "../world/ecs/define";
import type { Entity, Api as WorldApi } from "../world/types";
import type { Api, Under } from "./types";

/**
 * Names one entity under a point: its owner, the projection and key that address it, and the
 * layer its own `Layer` names.
 *
 * @param world - The world API.
 * @param entity - The entity hit.
 * @returns What lies there, or `undefined` for an entity that despawned this frame.
 */
function underOf(world: WorldApi, entity: Entity): Under | undefined {
  const owner = world.ecs.ownerOf(entity);

  if (owner === undefined) return undefined;

  return {
    entity,
    owner,
    key: world.projection.keyOf(entity),
    layer: world.ecs.get(entity, Layer)?.name
  };
}

/**
 * The counters of the renderer: frames per second, frame work, GPU textures and their memory,
 * views and pooled display objects, render passes, and in a dev build the draw calls.
 *
 * @example
 * ```ts
 * // The editor's stats panel on the board of Timber Town, in a dev build.
 * read(app, sources.render);
 * // { fps: 60, frameMs: 3.4, textures: 12, textureMb: 41.25, views: 180, pooled: 24, renderPasses: 1, drawCalls: 14 }
 * ```
 */
export const renderSource = defineSource({
  id: "game.render",
  title: "Render stats",
  input: {},
  changes: "frame",
  read: (app: HeadlessApp & { readonly renderer: Api }) => app.renderer.stats()
});

/**
 * What lies under a point of the page, topmost first: the point in client CSS pixels, the
 * coordinates `game.locate` answers and Playwright clicks, mapped through
 * `viewport.toReference`, and every view whose hit box holds it, with the skip rules of a tap.
 * `[]` while the renderer is inert and where nothing is drawn.
 *
 * @example
 * ```ts
 * // An agent asks what lies under the pointer on a 390 px wide phone: a shine over a board cell.
 * read(app, sources.at, { x: 195, y: 108.33 });
 * // [{ entity: 1048577, owner: { kind: "plugin", name: "fx" }, key: undefined, layer: undefined },
 * //  { entity: 1048576, owner: { kind: "projection", name: "board.items" },
 * //    key: { projection: "board.items", key: "c7" }, layer: "items" }]
 * ```
 */
export const atSource = defineSource({
  id: "game.at",
  title: "Under a point",
  input: { x: "number", y: "number" },
  changes: "frame",
  read: (
    app: HeadlessApp & { readonly renderer: Api; readonly world: WorldApi },
    { x, y }
  ): readonly Under[] => {
    const point = app.renderer.viewport.toReference(x, y);
    const found: Under[] = [];

    for (const entity of app.renderer.sync.hitAll(point.x, point.y)) {
      const under = underOf(app.world, entity);

      if (under !== undefined) found.push(under);
    }

    return found;
  }
});
