/**
 * @file world — the neutral value of an optional numeric field of a component type: the number a field means while a
 * stored value leaves it out. Engine-internal and pure. It sits beside the modules, not in one of them, because both
 * `ecs` (which declares it) and `projection` (which reads it to bring a field home) need it at run time.
 */
import type { ComponentType } from "./ecs/types";

/** The key under which a component type holds the neutral value of its optional numeric fields. Engine-internal. */
const NEUTRAL = Symbol("moku.neutral");

/**
 * Gives a component type the neutral value of its optional numeric fields: the number a field means while a stored value
 * leaves it out (`Transform`'s `scaleX` is 1). Engine-internal, not a root export: a tween that starts from a missing
 * field and `toRest` read it through `neutralOf`. The value hangs on the type object under a symbol, so it is neither
 * enumerable nor part of the type's public shape.
 *
 * @param type - The component type.
 * @param neutral - The neutral value of each field.
 * @returns The same type.
 */
export function withNeutral<Value extends object>(
  type: ComponentType<Value>,
  neutral: { readonly [K in keyof Value]?: number }
): ComponentType<Value> {
  Object.defineProperty(type, NEUTRAL, { value: Object.freeze({ ...neutral }) });

  return type;
}

/**
 * The neutral value of a field of a component type, set by `withNeutral`.
 *
 * @param type - The component type, or any handle.
 * @param field - The field name.
 * @returns The neutral value, or `undefined` when the type declares none for the field.
 */
export function neutralOf(type: object, field: string): number | undefined {
  const held: unknown = Reflect.get(type, NEUTRAL);

  if (typeof held !== "object" || held === null) return undefined;

  const value: unknown = Reflect.get(held, field);

  return typeof value === "number" ? value : undefined;
}
