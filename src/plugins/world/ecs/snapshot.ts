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
  if (Array.isArray(value)) return isJsonArray(value);
  if (typeof value !== "object") return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;

  // Index and `for…in` loops: the frame history asks for every changed row of a dev build (F70).
  for (const key in value) {
    if (Object.hasOwn(value, key) && !isJson(Reflect.get(value, key))) return false;
  }

  return true;
}

/**
 * Tells whether every entry of an array is plain JSON. A hole is skipped, as `every` skips it.
 *
 * @param value - The array to check.
 * @returns True when every entry is plain JSON.
 * @example
 * ```ts
 * isJsonArray([1, "a", [true]]); // true
 * ```
 */
function isJsonArray(value: readonly unknown[]): boolean {
  const count = value.length;

  for (let index = 0; index < count; index += 1) {
    if (index in value && !isJson(value[index])) return false;
  }

  return true;
}

/**
 * Builds the component map of one entity and names the values that are not JSON. The frame
 * history reads it too, so it records exactly what `snapshot()` shows. The values are the stored
 * objects, not copies.
 *
 * @param state - ecs module state.
 * @param entity - The entity to read.
 * @returns The JSON components and the names of the skipped ones.
 */
export function componentsOf(
  state: EcsState,
  entity: Entity
): { components: Record<string, Json>; skipped: string[] } {
  const components: Record<string, Json> = {};
  const skipped: string[] = [];

  for (const [name, store] of state.stores) {
    const value = store.get(entity);

    if (value === undefined) continue;

    const json = jsonOf(name, value);

    if (json === undefined) skipped.push(name);
    else components[name] = json;
  }

  return { components, skipped };
}

/**
 * The JSON of one stored component value, the rule `snapshot()` and the frame history share: a
 * tag is `true`, a plain JSON value is itself, an element description (`Tree`) and any value that
 * is not JSON have none. The value is the stored object, not a copy.
 *
 * @param name - The component name.
 * @param value - The stored value, or nothing when the entity does not carry it.
 * @returns The JSON, or `undefined` when nothing of it is recorded.
 * @example
 * ```ts
 * jsonOf("Score", { value: 3 }); // { value: 3 }
 * ```
 */
export function jsonOf(name: string, value: object | true | undefined): Json | undefined {
  // An element description belongs to `ui`, not to the save file: named, never serialised.
  if (value === undefined || name === Tree.componentName) return undefined;
  if (value === true) return true;

  return isJson(value) ? value : undefined;
}

/**
 * Builds the whole world as plain JSON, sorted by entity index. Every value is a copy of the
 * moment: the stores write their objects in place, so a snapshot that held them would follow
 * every later write, and a write into it would reach the world.
 *
 * @param state - ecs module state.
 * @param mode - The effective mode to report.
 * @returns The world as JSON.
 */
export function snapshotWorld(state: EcsState, mode: WorldMode): WorldSnapshot {
  const entities: EntitySnapshot[] = [...state.owners.entries()]
    .toSorted(([left], [right]) => indexOf(left) - indexOf(right))
    .map(([entity, owner]) => {
      const { components, skipped } = componentsOf(state, entity);

      return {
        id: entity,
        index: indexOf(entity),
        generation: generationOf(entity),
        owner: { kind: owner.kind, name: owner.name },
        components: structuredClone(components),
        skipped
      };
    });

  const resources: Record<string, Json> = {};

  for (const [name, value] of state.resources) {
    if (isJson(value)) resources[name] = structuredClone(value);
  }

  return { mode, entities, resources };
}
