/**
 * @file ui/layout — state factory: the Yoga module, the node per entity, the three counters the
 * acceptance tests read, the scroll the finger is on with the samples of its press, and the
 * patches the scroll step writes with.
 */
import type { LayoutState, ScrollPatches } from "./types";

/** How many pointer samples a press on a scroll keeps: the release velocity reads them. */
const SAMPLES = 5;

/**
 * Creates an empty map. Its own non-exported function, because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @returns A map with nothing in it.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Creates the ring of pointer samples: a position and a time for each of `SAMPLES`. Its own
 * non-exported function, for the same rule.
 *
 * @returns The ring, zeroed.
 */
function sampleRing(): Float64Array {
  return new Float64Array(SAMPLES * 2);
}

/**
 * Creates the patches the scroll step writes with, every field 0 or false.
 *
 * @returns The patches.
 */
function scrollPatches(): ScrollPatches {
  return {
    scroll: { offset: 0, min: 0 },
    state: { offset: 0, max: 0, moving: false },
    scrollable: { moving: false },
    x: { x: 0 },
    y: { y: 0 }
  };
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
    scrollClock: 0,
    scrollRing: sampleRing(),
    scrollHead: 0,
    scrollSamples: 0,
    scrollMoved: 0,
    scrollPatches: scrollPatches(),
    iconLine: undefined,
    order: 0,
    cleanups: []
  };
}
