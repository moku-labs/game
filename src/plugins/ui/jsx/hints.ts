/**
 * @file ui/jsx — the routing of a released hint to a keyed element: the rule of the world's
 * projections (`world/projection/hints.ts`) applied to the roots of `ui`. `hintFor` is pure;
 * `hintOf` reads the buffered hints and the roots of the jsx state, and writes nothing.
 */
import type { Hint } from "../../flow/types";
import type { Json } from "../../model/types";
import type { Element, JsxState } from "./types";

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

/**
 * The hint routed to an element in this frame step: the first hint released since the last one
 * whose payload names its key, within its root.
 *
 * @param state - The jsx state: the hints released since the last frame step and the roots.
 * @param element - The element whose hooks are about to run.
 * @returns The hint, or `undefined`.
 */
export function hintOf(state: JsxState, element: Element): Hint | undefined {
  if (state.hints.length === 0) return undefined;

  const root = state.roots.get(element.root);

  return root === undefined ? undefined : hintFor(state.hints, root.name, element.key);
}
