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

/** Bytes per frame step each fixture may keep allocated. */
export const BUDGET = {
  /** 50 bobbing loops of views nobody sees, walked and held. Before: 1 707 B. Now 0. */
  animTracksHeld: 0,
  /**
   * 50 tracks running, 75 fields moved per frame. Before: 13 306 B. Now 75 × 16 = 1 200 B, all of
   * it the numbers handed to world (`MOVED_FIELD`).
   */
  animTracks: 75 * MOVED_FIELD,
  /** 10 timelines that only wait. Before: 822 B. Now 0. */
  timelinesWaiting: 0,
  /**
   * 10 timelines running, 20 fields moved per frame (a tween and a nested tween each; the frames
   * step writes a texture key, no number). Before: 8 553 B. Now 20 × 16 = 320 B, all of it the
   * numbers handed to world (`MOVED_FIELD`).
   */
  timelines: 20 * MOVED_FIELD
} as const;
