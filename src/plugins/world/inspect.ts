/**
 * @file world plugin — the world sources of the `/inspect` door: the entities, filtered by owner
 * and component, and the projection keys. Production-safe: every source only reads.
 */
import { defineSource } from "../flow/doors/define";
import type { HeadlessApp } from "../flow/headless";
import type { Api, Entity, EntitySnapshot } from "./types";

/** What the world sources need of an app: the headless app plus the world. */
type WorldApp = HeadlessApp & { readonly world: Api };

/**
 * Tells whether an entity carries a component, as a JSON value or as a skipped one.
 *
 * @param entity - The entity snapshot.
 * @param component - The component name.
 * @returns True when the entity carries it.
 */
function carries(entity: EntitySnapshot, component: string): boolean {
  return Object.hasOwn(entity.components, component) || entity.skipped.includes(component);
}

/**
 * Every entity of the world as plain JSON, sorted by index: all of them, the ones of one owner,
 * the ones that carry a component, or both.
 *
 * @example
 * ```ts
 * // Which board items are on screen right now?
 * read(app, sources.entities, { owner: "board.items" });
 * // [{ id: 1048576, index: 0, generation: 1, owner: { kind: "projection", name: "board.items" },
 * //   components: { Layer: { name: "items" } }, skipped: ["Display"] }]
 * ```
 */
export const entitiesSource = defineSource({
  id: "game.entities",
  title: "Entities",
  input: { owner: "string?", component: "string?" },
  changes: "frame",
  read: (app: WorldApp, { owner, component }) =>
    app.world.ecs
      .snapshot()
      .entities.filter(
        entity =>
          (owner === undefined || entity.owner.name === owner) &&
          (component === undefined || carries(entity, component))
      )
});

/**
 * The projection keys of the world: projection name to key to the entity of its live view.
 *
 * @example
 * ```ts
 * // An agent finds the item it is about to drag.
 * read(app, sources.projections)["board.items"]; // { i5: 1048580, i7: 1048581 }
 * ```
 */
export const projectionsSource = defineSource({
  id: "game.projections",
  title: "Projections",
  input: {},
  changes: "commit",
  read: (app: WorldApp) => {
    const keys: Record<string, Record<string, Entity>> = {};

    for (const { id } of app.world.ecs.snapshot().entities) {
      const address = app.world.projection.keyOf(id);

      if (address === undefined) continue;

      keys[address.projection] = { ...keys[address.projection], [address.key]: id };
    }

    return keys;
  }
});
