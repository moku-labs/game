/**
 * @file ui plugin — the two conversions every module needs before it reaches the log or the ECS.
 * Pure: no ctx, no state.
 */
import type { AnyComponentType, ComponentHandle, TagType } from "../world/types";

/**
 * Turns whatever was thrown into the `Error` the log takes as its third argument.
 *
 * @param thrown - What a hook, a view or a reconcile threw.
 * @returns An error carrying the same message.
 * @example
 * ```ts
 * asError("boom").message; // "boom"
 * ```
 */
export function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * Reads a component value's type as the handle `ecs.set` takes. A component value always carries
 * a component type, never a tag: a tag's value is `true` and is never written with `set`.
 *
 * @param componentType - The type of a component value.
 * @returns The same object, typed as a handle.
 * @example
 * ```ts
 * asHandle(Box({ x: 0, y: 0, w: 8, h: 8 }).type).componentName; // "Box"
 * ```
 */
export function asHandle(componentType: AnyComponentType): ComponentHandle<object> {
  return componentType as ComponentHandle<object>;
}

/**
 * Reads a tag as the handle `onAdded` and `onRemoved` take. A tag has no defaults, so the type
 * asks for a component; the world fires the same hooks for a tag, which is how `ui` follows the
 * `Pressed` tag of `input`.
 *
 * @param tagType - The tag to watch.
 * @returns The same object, typed as a handle.
 * @example
 * ```ts
 * asTagHandle(Pressed).componentName; // "Pressed"
 * ```
 */
export function asTagHandle(tagType: TagType): ComponentHandle<object> {
  return tagType as unknown as ComponentHandle<object>;
}
