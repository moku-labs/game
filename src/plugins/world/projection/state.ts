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
 * Creates an empty weak table. It lives in its own non-exported function because lint rule L5
 * refuses a collection built inside an exported declaration.
 *
 * @returns An empty weak map.
 */
function emptyWeakMap<Key extends WeakKey, Value>(): WeakMap<Key, Value> {
  return new WeakMap();
}

/**
 * Creates the initial projection state: nothing registered, nothing mounted, no layer list, no
 * running track and no driver, so every motion is instant until `anim` installs one. No build
 * runs: `building` is absent.
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
    ownedSets: emptyWeakMap(),
    joinedMutes: emptyWeakMap(),
    converged: [],
    offHints: [],
    leaving: emptyMap(),
    membershipVersion: 0,
    moving: false,
    owedLoops: 0,
    sweptDespawns: 0,
    buildChecks: []
  };
}
