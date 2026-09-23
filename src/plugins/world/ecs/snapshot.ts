/**
 * @file world/ecs — the world as plain JSON, for tests and the inspector.
 */
import type { Json } from "../../model/types";
import { Tree } from "./define";
import { generationOf, indexOf } from "./entities";
import type { EcsState, Entity, EntitySnapshot, WorldMode, WorldSnapshot } from "./types";

/**
 * Tells whether a value survives `JSON.stringify` unchanged: a primitive, an array of such, or a
 * plain object of such. A Pixi display object does not.
 *
 * @param value - The value to check.
 * @returns True when the value is plain JSON.
 * @example
 * ```ts
 * isJson({ x: 1, tags: ["a"] }); // true
 * isJson(() => 1); // false
 * ```
 */
export function isJson(value: unknown): value is Json {
  if (value === null) return true;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return true;
  }
  if (Array.isArray(value)) return value.every(entry => isJson(entry));
  if (typeof value !== "object") return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;

  return Object.values(value).every(entry => isJson(entry));
}

/**
 * Builds the component map of one entity and names the values that are not JSON.
 *
 * @param state - ecs module state.
 * @param entity - The entity to read.
 * @returns The JSON components and the names of the skipped ones.
 */
function componentsOf(
  state: EcsState,
  entity: Entity
): { components: Record<string, Json>; skipped: string[] } {
  const components: Record<string, Json> = {};
  const skipped: string[] = [];

  for (const [name, store] of state.stores) {
    const value = store.get(entity);

    if (value === undefined) continue;
    // An element description belongs to `ui`, not to the save file: named, never serialised.
    if (name === Tree.componentName) {
      skipped.push(name);
    } else if (value === true) {
      components[name] = true;
    } else if (isJson(value)) {
      components[name] = value;
    } else {
      skipped.push(name);
    }
  }

  return { components, skipped };
}

/**
 * Builds the whole world as plain JSON, sorted by entity index.
 *
 * @param state - ecs module state.
 * @param mode - The effective mode to report.
 * @returns The world as JSON.
 */
export function snapshotWorld(state: EcsState, mode: WorldMode): WorldSnapshot {
  const entities: EntitySnapshot[] = [...state.owners.entries()]
    .toSorted(([left], [right]) => indexOf(left) - indexOf(right))
    .map(([entity, owner]) => ({
      id: entity,
      index: indexOf(entity),
      generation: generationOf(entity),
      owner: { kind: owner.kind, name: owner.name },
      ...componentsOf(state, entity)
    }));

  const resources: Record<string, Json> = {};

  for (const [name, value] of state.resources) {
    if (isJson(value)) resources[name] = value;
  }

  return { mode, entities, resources };
}
