/**
 * @file world/ecs — the component schema the editor's palette reads: every component and tag type
 * the world met, with the JSON kind of each field. Pure: it reads the types it is given and
 * nothing else.
 */
import type { Json } from "../../model/types";
import { isJson } from "./snapshot";
import type { AnyComponentType, ComponentSchema, FieldKind } from "./types";

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "defaults the schema cannot carry".
const notJson: Json = null;

/**
 * What a registered type may carry next to its name: a type made by `component()` has its
 * defaults and its owned fields, a tag has neither.
 */
type Registered = AnyComponentType & {
  readonly defaults?: object;
  readonly owned?: readonly string[];
};

/**
 * The JSON kind of one default value.
 *
 * @param value - The default of one field, plain JSON.
 * @returns Its kind.
 * @example
 * ```ts
 * fieldKind([1, 2]); // "array"
 * ```
 */
export function fieldKind(value: Json): FieldKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";

  return "boolean";
}

/**
 * Reads defaults as a plain JSON record, the one shape a component's defaults have when they are
 * JSON at all.
 *
 * @param defaults - The defaults of a registered type, if it carries any.
 * @returns The record, or `undefined` when the defaults are missing or not JSON.
 */
function jsonRecordOf(defaults: object | undefined): Record<string, Json> | undefined {
  if (!isJson(defaults) || Array.isArray(defaults)) return undefined;

  return defaults;
}

/**
 * Describes one registered type. A tag is `true` with no field; a component whose defaults are not
 * JSON says so and describes no field.
 *
 * @param type - The registered type.
 * @returns Its schema entry, built from fresh objects.
 */
function schemaOfType(type: Registered): ComponentSchema {
  const name = type.componentName;

  if (type.kind === "tag") {
    return { name, kind: "tag", json: true, fields: {}, defaults: true, owned: [] };
  }

  const owned = [...(type.owned ?? [])];
  const defaults = jsonRecordOf(type.defaults);

  if (defaults === undefined) {
    return { name, kind: "component", json: false, fields: {}, defaults: notJson, owned };
  }

  const fields: Record<string, FieldKind> = {};

  for (const [field, value] of Object.entries(defaults)) fields[field] = fieldKind(value);

  return {
    name,
    kind: "component",
    json: true,
    fields,
    defaults: structuredClone(defaults),
    owned
  };
}

/**
 * Describes every registered type, sorted by name.
 *
 * @param types - The types the world met, as `state.types` holds them.
 * @returns A new list, one entry per type.
 */
export function schemaOf(types: Iterable<Registered>): ComponentSchema[] {
  return [...types]
    .map(type => schemaOfType(type))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}
