/**
 * @file anim plugin — state factory. The plugin starts empty: `onInit` registers the frame step,
 * `onStart` fills the registry and installs the driver.
 */
import type { EndedRecord } from "./timeline/types";
import { TrackTable } from "./tween/table";
import type { Track } from "./tween/types";
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

/** How many ended timelines the ring of `timelines()` keeps. */
export const ENDED_CAPACITY = 16;

/**
 * Makes the 16 records of the ring of ended timelines, once, so an end only overwrites them.
 *
 * @returns Sixteen blank records.
 */
function blankRing(): EndedRecord[] {
  const ring: EndedRecord[] = [];

  for (let index = 0; index < ENDED_CAPACITY; index++) {
    ring.push({ timeline: 0, animation: "", startFrame: 0, endFrame: 0, reason: "ended" });
  }

  return ring;
}

/**
 * Creates the initial anim state: an empty track table, the empty field bookkeeping of the
 * retarget policy and the offsets accumulator, no timeline (and a ring of 16 blank records for the
 * ended ones), no animation and no frame loop, and reduced motion at its configured start value.
 *
 * @param ctx - Minimal context.
 * @param ctx.config - Resolved plugin config.
 * @returns The plugin state.
 */
export function createAnimState(ctx: { readonly config: Readonly<Config> }): State {
  const trackList: Track[] = [];

  return {
    tracks: new TrackTable(trackList),
    trackList,
    nextId: 1,
    owner: emptyMap(),
    offsets: emptyMap(),
    bases: emptyMap(),
    additive: emptyMap(),
    timelines: emptyMap(),
    timelineList: [],
    ended: blankRing(),
    endedNext: 0,
    endedCount: 0,
    registry: emptyMap(),
    markListeners: emptySet(),
    frame: 0,
    bornFrom: 0,
    overMaxTracks: false,
    reducedMotion: ctx.config.reducedMotion,
    removeDriver: undefined,
    offFrame: undefined,
    offSample: undefined,
    offPose: undefined,
    offPlay: undefined,
    finishAll: undefined,
    frameLoops: emptyMap(),
    framesHeld: emptyMap(),
    frameMutes: emptyMap(),
    offFrames: [],
    loopsHeld: undefined,
    warnedLoops: emptySet(),
    freeTracks: [],
    freeCells: [],
    absent: new Int32Array(2)
  };
}
