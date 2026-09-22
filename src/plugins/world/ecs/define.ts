/**
 * @file world/ecs — the authoring helpers. Pure: no ctx, no state, no world. A type made here
 * registers itself in the world on first use, so nothing has to be declared twice.
 */
import type { DescriptionNode } from "../projection/types";
import type {
  ComponentHandle,
  ComponentType,
  ComponentValue,
  Mut,
  QueryTerm,
  ResourceType,
  SystemDefinition,
  TagType,
  TagValue
} from "./types";

/**
 * Declares a component type. The defaults give the TypeScript type, the JSON shape and the
 * inspector schema; the name is the storage key and the key of `motion.change`.
 *
 * @param name - Storage name, unique per world.
 * @param defaults - Every field with its default value. Plain JSON only.
 * @returns A callable component type.
 * @example
 * ```ts
 * const Item = component("Item", { kind: "", level: 1 });
 * Item({ level: 2 }); // { type: Item, value: { kind: "", level: 2 } }
 * Item({ level: 2 }).type.componentName; // "Item", the storage key
 * ```
 */
export function component<Value extends object>(
  name: string,
  defaults: Value
): ComponentType<Value> {
  const frozenDefaults: Readonly<Value> = Object.freeze({ ...defaults });

  const make = (patch?: Partial<Value>): ComponentValue<Value> =>
    Object.freeze({ type: componentType, value: Object.freeze({ ...frozenDefaults, ...patch }) });

  const componentType: ComponentType<Value> = Object.assign(make, {
    componentName: name,
    defaults: frozenDefaults,
    kind: "component"
  } as const);

  return componentType;
}

/**
 * Declares a tag: a component with no data, stored as `true`.
 *
 * @param name - Storage name, unique per world.
 * @returns A callable tag type.
 * @example
 * ```ts
 * const Held = tag("Held");
 * Held(); // { type: Held, value: true }
 * Held().type.componentName; // "Held"
 * ```
 */
export function tag(name: string): TagType {
  const make = (): TagValue => Object.freeze({ type: tagType, value: true as const });

  const tagType: TagType = Object.assign(make, { componentName: name, kind: "tag" } as const);

  return tagType;
}

/**
 * Declares a resource: one mutable object per world, created from a deep clone of the defaults
 * on first read.
 *
 * @param name - Storage name, unique per world.
 * @param defaults - The value a fresh world starts with.
 * @returns The resource type.
 * @example
 * ```ts
 * const Pointer = resource("Pointer", { x: 0, y: 0, down: false });
 * Pointer.defaults; // { x: 0, y: 0, down: false }
 * ```
 */
export function resource<Value extends object>(name: string, defaults: Value): ResourceType<Value> {
  return { resourceName: name, defaults: Object.freeze({ ...defaults }) };
}

/**
 * Marks a query term as written. The only effect is change detection: every entity the query
 * yields is marked changed for this component.
 *
 * @param componentType - The component the system writes.
 * @returns The marked term.
 * @example
 * ```ts
 * const Transform = component("Transform", { x: 0, y: 0 });
 * mut(Transform).kind; // "mut"
 * ```
 */
export function mut<Value extends object>(componentType: ComponentHandle<Value>): Mut<Value> {
  return { kind: "mut", of: componentType };
}

/**
 * Types a system definition. It returns the same plain object; the work is the type, which reads
 * the query tuple and types the first argument of `run`.
 *
 * @param definition - Name, phase, query and the run function.
 * @returns The same definition, typed.
 * @example
 * ```ts
 * const Transform = component("Transform", { x: 0, y: 0 });
 * const drift = system({
 *   name: "drift",
 *   phase: "animate",
 *   query: [mut(Transform)],
 *   run: entities => {
 *     for (const [, transform] of entities) transform.x += 1;
 *   }
 * });
 * drift.phase; // "animate"
 * ```
 */
export function system<const Terms extends readonly QueryTerm[]>(
  definition: SystemDefinition<Terms>
): SystemDefinition<Terms> {
  return definition;
}

/**
 * The layer a view is drawn in. Written only by the projection; a `view` that returns it is
 * logged and the value ignored.
 */
export const Layer = /*#__PURE__*/ component("Layer", { name: "" });

/**
 * Explicit draw order inside a layer sorted by `"order"`.
 */
export const Order = /*#__PURE__*/ component("Order", { value: 0 });

/**
 * The view is in the despawn queue: still drawn, never hit-tested.
 */
export const Exiting = /*#__PURE__*/ tag("Exiting");

/** What a `Tree` holds before a projection wrote its first node. */
const emptyNode: DescriptionNode = { type: "", props: {}, children: [] };

/**
 * The element description of a screen: a projection whose `view` returns one node gets it wrapped
 * as this component, and `ui` reconciles the node into child entities. The node is a foreign
 * object, so the world diffs it by identity and `snapshot()` leaves it out.
 */
export const Tree = /*#__PURE__*/ component("Tree", { node: emptyNode });
