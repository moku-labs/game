/**
 * @file assets plugin — state factory.
 */
import { emptyManifest } from "./manifest";
import type { State } from "./types";

/**
 * Creates an empty map. It lives in its own non-exported function because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @returns An empty map.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Creates an empty set, for the same reason as `emptyMap`.
 *
 * @returns An empty set.
 */
function emptySet<Value>(): Set<Value> {
  return new Set();
}

/**
 * Creates the initial state: headless, with an empty manifest and empty registries. `onStart`
 * fills it from the config and from the feature descriptions.
 *
 * @returns The plugin state.
 * @example
 * ```ts
 * const state = createAssetsState();
 * state.manifest.bundles; // {}
 * ```
 */
export function createAssetsState(): State {
  return {
    io: undefined,
    manifest: emptyManifest(),
    bundleOfKey: emptyMap(),
    bundleOfScene: emptyMap(),
    featureOfFlow: emptyMap(),
    records: emptyMap(),
    pinned: emptySet(),
    sceneBundle: undefined,
    queue: undefined,
    current: undefined,
    useCounter: 0,
    warned: emptySet(),
    removers: []
  };
}
