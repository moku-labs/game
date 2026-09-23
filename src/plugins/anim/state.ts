/**
 * @file anim plugin — state factory. The plugin starts empty: `onInit` registers the frame step,
 * `onStart` fills the registry and installs the driver.
 */
import type { Config, State } from "./types";

/**
 * Creates one empty table. It lives in its own non-exported function because lint rule L5 refuses
 * a collection built inside an exported declaration.
 *
 * @returns An empty map.
 */
function emptyMap<Key, Value>(): Map<Key, Value> {
  return new Map();
}

/**
 * Creates the empty listener set of `onMark`, for the same reason as `emptyMap`.
 *
 * @returns An empty set.
 */
function emptySet<Value>(): Set<Value> {
  return new Set();
}

/**
 * Creates the initial anim state: an empty track table, the empty field bookkeeping of the
 * retarget policy and the offsets accumulator, no timeline and no animation, and reduced motion
 * at its configured start value.
 *
 * @param ctx - Minimal context.
 * @param ctx.config - Resolved plugin config.
 * @returns The plugin state.
 */
export function createAnimState(ctx: { readonly config: Readonly<Config> }): State {
  return {
    tracks: emptyMap(),
    nextId: 1,
    owner: emptyMap(),
    offsets: emptyMap(),
    bases: emptyMap(),
    timelines: emptyMap(),
    registry: emptyMap(),
    markListeners: emptySet(),
    frame: 0,
    overMaxTracks: false,
    reducedMotion: ctx.config.reducedMotion,
    removeDriver: undefined,
    offFrame: undefined,
    offPlay: undefined,
    finishAll: undefined
  };
}
