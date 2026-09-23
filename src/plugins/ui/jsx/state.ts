/**
 * @file ui/jsx — state factory: the component registry, the roots, the elements and the
 * instances whose local state outlives every render.
 */
import type { JsxState } from "./types";

/**
 * Creates an empty map. Its own non-exported function, because lint rule L5 refuses a collection
 * built inside an exported declaration.
 *
 * @returns A map with nothing in it.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Creates an empty set, for the same reason as `emptyMap`.
 *
 * @returns A set with nothing in it.
 */
function emptySet<Value>(): Set<Value> {
  return new Set();
}

/**
 * Creates the jsx branch of the ui state. Everything starts empty: the registry is filled in
 * `onStart` from the `ui` key of every feature.
 *
 * @returns The module state.
 * @example
 * ```ts
 * createJsxState().roots.size; // 0
 * ```
 */
export function createJsxState(): JsxState {
  return {
    components: emptyMap(),
    roots: emptyMap(),
    elements: emptyMap(),
    byIdentity: emptyMap(),
    byKey: emptyMap(),
    instances: emptyMap(),
    exiting: emptySet(),
    removing: emptySet(),
    hosts: emptySet(),
    hosted: emptyMap(),
    reconciles: 0,
    focus: { entity: undefined, ring: undefined, drawn: undefined, tapping: false }
  };
}
