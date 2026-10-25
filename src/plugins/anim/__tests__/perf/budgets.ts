/**
 * @file anim plugin — the heap budgets of the perf tests, in bytes per frame step. Each line says
 * what the step measured before its fix (change 2026-10-18-cheap-idle-tick, items A1 and A2) and
 * what it holds now; a line above 0 names its reason. The tests add the 1 B per call the `alloc`
 * helper itself tolerates.
 */

/**
 * What a frame step that moves fields keeps, per moved field: 16 B, the one number handed to
 * `world`. A component is a plain object, so the new value reaches it boxed: V8 boxes a double
 * written through a variable key (the patch for `ecs.set`). `writeNumber` of world measured the
 * same 16 B (its `value` argument boxes) and would hide the write from `ecs.set`, which tests
 * observe, so the patch stays. The read of the stored value is gone: a field whose value moved
 * off the one the track last left there is written without reading it back. Only a component
 * store that keeps numbers in typed arrays removes the rest (LATER, backlog item 25). Anim's own
 * code adds nothing.
 */
const MOVED_FIELD = 16;

/**
 * What a frame step that keeps a field still keeps, at most, per still field: 16 B. A track whose
 * value stands still reads the field back, so a writer that moved it in between is undone
 * (writes.test.ts). V8 boxes a field it keeps as a double when it is read through a variable key,
 * so the read is a new number; a field kept as a small integer reads for free, which is why a
 * measure of the same fixture gives 0 to 16 B per field, by what the process wrote before.
 * `ecs.set` writes the stored object in place, so anim cannot tell a foreign write by identity;
 * only a write counter of `world.ecs` would remove the read. It is the same for the still frames
 * of a view's loop (measured 160 to 480 B for 10 view loops in their pause, change
 * 2026-10-25-f75-f76-timeline-loops) and older than it.
 */
const STILL_FIELD = 16;

/** Bytes per frame step each fixture may keep allocated. */
export const BUDGET = {
  /** 50 bobbing loops of views nobody sees, walked and held. Before: 1 707 B. Now 0. */
  animTracksHeld: 0,
  /**
   * 50 tracks running, 75 fields moved per frame. Before: 13 306 B. Now 75 × 16 = 1 200 B, all of
   * it the numbers handed to world (`MOVED_FIELD`).
   */
  animTracks: 75 * MOVED_FIELD,
  /**
   * 50 tracks whose `y` a hand holds, 50 fields moved per frame (E6, change
   * 2026-10-18-render-path-garbage). Before: 3 601 B, a new patch of the moved fields per track.
   * Now 50 × 16 = 800 B, all of it the numbers handed to world (`MOVED_FIELD`): the track keeps
   * its patch of the moved fields.
   */
  animTracksPartial: 50 * MOVED_FIELD,
  /** 10 timelines that only wait. Before: 822 B. Now 0. */
  timelinesWaiting: 0,
  /**
   * 10 timelines running, 20 fields moved per frame (a tween and a nested tween each; the frames
   * step writes a texture key, no number). Before: 8 553 B. Now 20 × 16 = 320 B, all of it the
   * numbers handed to world (`MOVED_FIELD`).
   */
  timelines: 20 * MOVED_FIELD,
  /**
   * 10 endless bounces a system played through `AnimPlayer`, 20 fields moved per frame (F75, change
   * 2026-10-25-f75-f76-timeline-loops). New: 20 × 16 = 320 B, all of it the numbers handed to world
   * (`MOVED_FIELD`); the timeline and its endless tracks add nothing.
   */
  foreverBounces: 20 * MOVED_FIELD,
  /**
   * The same 10 bounces in their pause, where no field moves: the frames of a chest between hops.
   * New: at most 20 × 16 = 320 B, all of it the read-back of the still fields (`STILL_FIELD`); the
   * timeline and its endless tracks add nothing.
   */
  foreverBouncesResting: 20 * STILL_FIELD,
  /** The same 10 bounces of views nobody sees (F76): each asks the renderer, none writes. New: 0. */
  foreverBouncesHeld: 0,
  /**
   * One eased time on a curve of `cubicBezier`, a design curve and one that leaves vertically (E6).
   * Before, the game's own `cubicBezier` solved the curve by Newton at every call: 48 B. Now 0.
   */
  cubicBezier: 0
} as const;
