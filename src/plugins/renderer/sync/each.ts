/**
 * @file renderer/sync — the walk of a change list of the world without an iterator object. `world.ecs.changed`
 * answers an `Iterable`: an array of the frame's changes, or one shared empty array. A `for…of` that sees arrays and
 * `Set`s at one call site makes V8 build an iterator object at every walk (measured: about 100 bytes a list), and the
 * sync pass walks eight lists a frame. An array has its own loop, which sees nothing else; a `Set` (a copy the rare
 * steps make) goes through the other.
 */
import type { Entity } from "../../world/types";

/**
 * Tells whether a change list is an array.
 *
 * @param list - The change list.
 * @returns True for an array.
 */
function isList(list: Iterable<Entity>): list is readonly Entity[] {
  return Array.isArray(list);
}

/**
 * Tells whether a change list holds no entity, an array without walking it.
 *
 * @param list - The change list.
 * @returns True when it is empty.
 * @example
 * ```ts
 * isEmptyList([1_048_576]); // false
 * ```
 */
export function isEmptyList(list: Iterable<Entity>): boolean {
  if (isList(list)) return list.length === 0;

  return list[Symbol.iterator]().next().done === true;
}

/**
 * Calls `visit` for every entity of a change list, in its order. `visit` is made once by its owner, never per walk.
 *
 * @param list - The change list.
 * @param visit - Called with each entity.
 */
export function eachEntity(list: Iterable<Entity>, visit: (entity: Entity) => void): void {
  if (isList(list)) {
    // per frame: one kind at this loop, a plain array: V8's inlined fast path, no iterator object.
    for (const entity of list) visit(entity);

    return;
  }

  for (const entity of list) visit(entity);
}
