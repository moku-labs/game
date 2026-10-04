/**
 * @file ui/jsx — the routing of a released hint to a keyed element: the rule of the world's
 * projections (`world/projection/hints.ts`) applied to the roots of `ui`. Pure.
 */
import type { Hint } from "../../flow/types";
import type { Json } from "../../model/types";

/**
 * Reads the payload of a hint as a plain object. A hint without one routes nowhere.
 *
 * @param payload - The payload of a released hint.
 * @returns True for a JSON object.
 */
function isFields(payload: Json | undefined): payload is { [field: string]: Json } {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload);
}

/**
 * Finds the hint for one element of one root: the first whose payload has a top-level value equal
 * to the element's key. A `projection` field narrows the hint to the root of that name, the
 * projection of a screen or the component of a popup; it is never read as a key.
 *
 * @param hints - The hints released since the last frame step, in order.
 * @param root - The name of the root the element belongs to.
 * @param key - The key of the element; an unkeyed element gets no hint.
 * @returns The hint, or `undefined`.
 * @example
 * ```ts
 * hintFor([{ kind: "coins.fly", payload: { projection: "hud", key: "coinPillText" }, hint: true }], "hud", "coinPillText")?.kind; // "coins.fly"
 * ```
 */
export function hintFor(
  hints: readonly Hint[],
  root: string,
  key: string | undefined
): Hint | undefined {
  if (key === undefined) return undefined;

  for (const hint of hints) {
    const fields = hint.payload;

    if (!isFields(fields)) continue;
    if (typeof fields.projection === "string" && fields.projection !== root) continue;

    const names = Object.entries(fields).some(
      ([field, value]) => field !== "projection" && value === key
    );

    if (names) return hint;
  }

  return undefined;
}
