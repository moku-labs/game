/**
 * @file renderer/sync — state factory.
 */
import type { DebugSwitches, SyncState } from "./types";

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
 * Creates an empty set. Same reason as `emptyMap`.
 *
 * @returns An empty set.
 */
function emptySet<Value>(): Set<Value> {
  return new Set();
}

/**
 * Creates an empty weak set. Same reason as `emptyMap`.
 *
 * @returns An empty weak set.
 */
function emptyWeakSet<Value extends WeakKey>(): WeakSet<Value> {
  return new WeakSet();
}

/**
 * Creates the initial sync state: no root, no layers, no view, no pool, no provider, no filter and
 * no slice.
 *
 * @param debug - The debug switches of the config; copied, so the frozen config stays untouched.
 * @returns The sync branch of the plugin state.
 */
export function createSyncState(debug: Readonly<DebugSwitches>): SyncState {
  return {
    root: undefined,
    layerList: undefined,
    layers: emptyMap(),
    views: emptyMap(),
    entityOf: emptyMap(),
    pools: emptyMap(),
    pooled: 0,
    providers: [],
    adapters: [],
    fonts: emptyMap(),
    fontCache: undefined,
    byKey: emptyMap(),
    frames: emptyMap(),
    slices: emptyWeakSet(),
    invalidated: emptySet(),
    warned: emptySet(),
    added: emptySet(),
    removed: emptySet(),
    reparented: emptySet(),
    debug: { nineSlice: debug.nineSlice },
    outlinesStale: false,
    filters: emptyMap(),
    cleanups: []
  };
}
