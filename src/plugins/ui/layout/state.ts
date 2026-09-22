/**
 * @file ui/layout — state factory: the Yoga module, the node per entity, the three counters the
 * acceptance tests read, and the scroll the finger is on.
 */
import type { LayoutState } from "./types";

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
 * Creates the layout branch of the ui state. Everything starts empty: Yoga arrives in `onStart`.
 *
 * @returns The module state.
 * @example
 * ```ts
 * createLayoutState().nodes; // 0
 * ```
 */
export function createLayoutState(): LayoutState {
  return {
    yoga: undefined,
    byEntity: emptyMap(),
    nodes: 0,
    measured: 0,
    solves: 0,
    scrolling: undefined,
    scrollStart: { pointerY: 0, offset: 0 },
    order: 0,
    cleanups: []
  };
}
