/**
 * @file input plugin — the projection key a command names in its JSON. Kept apart from the
 * command bodies of `control.ts`, so a source of the `/inspect` door reads a target without
 * pulling a command into its bundle.
 */
import type { Json } from "../model/types";

/**
 * A projection key, the target the JSON of a command names.
 *
 * @example
 * ```ts
 * const target: ProjectionTarget = { projection: "board.items", key: "i5" };
 * ```
 */
export type ProjectionTarget = { projection: string; key: string };

/**
 * Tells whether the JSON a command got names a view by its projection key.
 *
 * @param value - The JSON.
 * @returns True for an object with a string `projection` and a string `key`.
 * @example
 * ```ts
 * isProjectionTarget({ projection: "board.items", key: "i5" }); // true
 * ```
 */
export function isProjectionTarget(value: Json | undefined): value is ProjectionTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.projection === "string" &&
    typeof value.key === "string"
  );
}

/**
 * Reads the projection key of a view out of the JSON a command got.
 *
 * @param value - The JSON: `{ projection, key }`.
 * @returns The target, a fresh object.
 * @throws {Error} When the JSON is not an object with a string `projection` and a string `key`.
 */
export function readTarget(value: Json | undefined): ProjectionTarget {
  if (isProjectionTarget(value)) return { projection: value.projection, key: value.key };

  throw new Error(
    '[game] The target is not a projection key.\n  Pass a view like { projection: "board.items", key: "i5" }.'
  );
}
