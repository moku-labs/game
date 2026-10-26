/**
 * @file renderer/sync — state factory.
 */
import { createOverdrawState } from "./overdraw";
import type {
  AsideQueue,
  DebugSwitches,
  OverlayState,
  SyncState,
  UploadState,
  WarmState
} from "./types";

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
 * Creates an empty weak map. Same reason as `emptyMap`.
 *
 * @returns An empty weak map.
 */
function emptyWeakMap<Key extends WeakKey, Value>(): WeakMap<Key, Value> {
  return new WeakMap();
}

/**
 * Creates the empty overlay state: no overlay, no HUD part, no range. Its own non-exported function, as `emptyMap`.
 *
 * @returns The overlay branch of the sync state.
 */
function createOverlayState(): OverlayState {
  return {
    entities: emptySet(),
    parts: emptySet(),
    records: emptyMap(),
    order: [],
    active: undefined,
    range: undefined,
    offTops: emptySet(),
    warned: emptySet(),
    events: [],
    wantEntries: [],
    wantOthers: [],
    wantSet: emptySet(),
    flipped: emptySet(),
    nextOff: emptySet(),
    left: false,
    bounds: undefined
  };
}

/**
 * Creates the empty warm-up state: nothing queued, nothing handed over, no probe tree. Its own non-exported function,
 * as `emptyMap`.
 *
 * @returns The warm branch of the sync state.
 */
function createWarmState(): WarmState {
  return {
    queue: [],
    head: 0,
    filters: emptySet(),
    waiting: emptyMap(),
    textQueued: false,
    textFont: undefined,
    objects: undefined,
    draws: 0,
    failed: false,
    reported: emptySet(),
    listeners: []
  };
}

/**
 * Creates the empty upload queue: nothing queued, nobody waiting, nothing uploaded. Its own non-exported function, as
 * `emptyMap`.
 *
 * @returns The upload branch of the sync state.
 */
function createUploadState(): UploadState {
  return { queue: [], head: 0, waiting: emptyMap(), done: emptyWeakSet() };
}

/**
 * Creates the empty aside queue of a scene build: nothing waits for a view. Its own non-exported function, as
 * `emptyMap`.
 *
 * @returns The aside branch of the sync state.
 */
function createAsideQueue(): AsideQueue {
  return { entities: [], count: 0, head: 0, waiting: emptySet(), made: 0 };
}

/**
 * Creates the initial sync state: no root, no layers, no view, no orphan, no pool, no provider, no filter, no
 * filter area, no slice, no hidden mask, no overlay, no warm-up, no upload, no redraw counted, no unseen walk kept,
 * no scene build and no picture of a scene being left.
 *
 * @param debug - The debug switches of the config; copied, so the frozen config stays untouched.
 * @returns The sync branch of the plugin state.
 */
export function createSyncState(debug: Readonly<Partial<DebugSwitches>>): SyncState {
  // Inline and positive: the overdraw switch of the config stays off in a production build.
  const overdrawInDebugBuild =
    debug.overdraw === true &&
    ((typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
      (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__));

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
    blendWarned: emptySet(),
    added: emptySet(),
    removed: emptySet(),
    reparented: emptySet(),
    orphans: emptySet(),
    mismatched: emptySet(),
    debug: { nineSlice: debug.nineSlice === true, overdraw: overdrawInDebugBuild },
    overdraw: createOverdrawState(),
    outlinesStale: false,
    filters: emptyMap(),
    areas: emptyMap(),
    viewlessEntries: false,
    warm: createWarmState(),
    upload: createUploadState(),
    hollowClass: undefined,
    filterKinds: emptyWeakMap(),
    filterOwners: emptyWeakMap(),
    objectHidden: emptyWeakMap(),
    viewOfTop: emptyWeakMap(),
    overlay: createOverlayState(),
    redraws: 0,
    held: emptyMap(),
    passesVersion: 0,
    passes: { at: -1, root: undefined, filtered: 0, count: 0, filters: [], enabled: [] },
    hudLayer: undefined,
    aside: createAsideQueue(),
    heldViews: { entities: [], count: 0, reported: false },
    leave: {},
    cleanups: []
  };
}
