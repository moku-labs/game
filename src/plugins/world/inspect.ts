/**
 * @file world plugin — the world sources of the `/inspect` door: the entities, filtered by owner
 * and component, the projection keys, one entity in full, what changed between two frames and
 * the component schema. Every source only reads; `game.diff` answers in a dev build only, because
 * only a dev build keeps the frame history.
 */
import { defineSource } from "../flow/doors/define";
import type { HeadlessApp } from "../flow/headless";
import type { Api, Entity, EntitySnapshot, Explained } from "./types";

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

/**
 * One entity in full: its owner, its projection key, every JSON component, the names of the
 * skipped ones and the components a motion still drives. `undefined` for a stale id. The source
 * reads the whole snapshot once per read and picks the row.
 *
 * @example
 * ```ts
 * // The editor explains item i7 while it slides to its new cell.
 * read(app, sources.explain, { entity: 1048577 });
 * // { id: 1048577, owner: { kind: "projection", name: "board.items" },
 * //   key: { projection: "board.items", key: "i7" },
 * //   components: { Transform: { x: 64, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
 * //     Layer: { name: "items" } }, skipped: [], motions: ["Transform"] }
 * read(app, sources.explain, { entity: 42 }); // undefined: a stale id
 * ```
 */
export const explainSource = defineSource({
  id: "game.explain",
  title: "Entity",
  input: { entity: "number" },
  changes: "frame",
  read: (app: WorldApp, { entity }): Explained | undefined => {
    const row = app.world.ecs.snapshot().entities.find(candidate => candidate.id === entity);

    if (row === undefined) return undefined;

    return {
      id: row.id,
      owner: row.owner,
      key: app.world.projection.keyOf(row.id),
      components: row.components,
      skipped: row.skipped,
      motions: app.world.projection.motionsOf(row.id)
    };
  }
});

/**
 * What changed between the world at the end of frame `from` and at the end of frame `to`, from
 * the frame history of a dev build: one entry per entity, sorted by id. Throws in a production
 * build and for a frame outside the last 120.
 *
 * @example
 * ```ts
 * // The editor asks what the last second of play changed: item i7 merged up to level 3.
 * read(app, sources.diff, { from: 120, to: 180 });
 * // { from: 120, to: 180, entities: [{ id: 1048577,
 * //   owner: { kind: "projection", name: "board.items" },
 * //   key: { projection: "board.items", key: "i7" }, change: "changed",
 * //   components: { Level: { from: { level: 2 }, to: { level: 3 } } } }] }
 * ```
 */
export const diffSource = defineSource({
  id: "game.diff",
  title: "Frame diff",
  input: { from: "number", to: "number" },
  changes: "frame",
  read: (app: WorldApp, { from, to }) => app.world.ecs.diff(from, to)
});

/**
 * Every component and tag type the world met so far, sorted by name, with the JSON kind of each
 * field: the editor's component palette. A system may write a new component on any frame, so it
 * is read again every frame.
 *
 * @example
 * ```ts
 * // The editor's component palette, in a world that has met Transform and the tag Held.
 * read(app, sources.schema);
 * // [{ name: "Held", kind: "tag", json: true, fields: {}, defaults: true, owned: [] },
 * //  { name: "Transform", kind: "component", json: true,
 * //    fields: { x: "number", y: "number", rotation: "number", scale: "number", pivot: "object" },
 * //    defaults: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }, owned: [] }]
 * ```
 */
export const schemaSource = defineSource({
  id: "game.schema",
  title: "Components",
  input: {},
  changes: "frame",
  read: (app: WorldApp) => app.world.ecs.schema()
});
