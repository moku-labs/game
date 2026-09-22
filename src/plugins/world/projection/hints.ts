/**
 * @file world/projection — hint routing: a released hint finds its entry by a key in its payload.
 */
import type { Hint } from "../../flow/types";

/**
 * Reads the payload of a hint as a plain object. A hint without one routes nowhere.
 *
 * @param hint - The released hint.
 * @returns The payload fields, or `undefined`.
 */
function fieldsOf(hint: Hint): Record<string, unknown> | undefined {
  const payload = hint.payload;

  if (payload === undefined || payload === null) return undefined;
  if (typeof payload !== "object" || Array.isArray(payload)) return undefined;

  return payload;
}

/**
 * Finds the first hint that names one key of one projection. A `projection` field in the payload
 * narrows the hint to that projection; every other top-level string value is a key.
 *
 * @param hints - The hint buffer of this frame.
 * @param projection - Name of the projection of the entry.
 * @param key - The model key of the entry.
 * @returns The hint for this entry, or `undefined`.
 */
export function routeHint(
  hints: readonly Hint[],
  projection: string,
  key: string
): Hint | undefined {
  for (const hint of hints) {
    const fields = fieldsOf(hint);

    if (fields === undefined) continue;

    const narrow = fields.projection;

    if (typeof narrow === "string" && narrow !== projection) continue;

    for (const [field, value] of Object.entries(fields)) {
      if (field !== "projection" && value === key) return hint;
    }
  }

  return undefined;
}
