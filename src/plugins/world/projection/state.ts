/**
 * @file world/projection — state factory.
 */
import type { ProjectionState } from "./types";

/**
 * Creates an empty collection. It lives in its own non-exported function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty map.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Creates the initial projection state: nothing registered, nothing mounted, no layer list, no
 * running track and no driver, so every motion is instant until `anim` installs one.
 *
 * @returns The projection branch of the plugin state.
 */
export function createProjectionState(): ProjectionState {
  return {
    specs: emptyMap(),
    layers: Object.freeze([]),
    mounted: emptyMap(),
    byEntity: emptyMap(),
    dirty: undefined,
    hints: [],
    tracks: [],
    driver: undefined,
    rests: emptyMap(),
    keys: emptyMap(),
    keysByEntity: emptyMap(),
    mutes: emptyMap(),
    offHints: []
  };
}
