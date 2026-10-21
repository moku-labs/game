/**
 * @file ui plugin — the heap budgets of the perf tests, in bytes per call. Each line says what the
 * call kept before its fix (change 2026-10-18-cheap-idle-tick, Node 24.21 on the Mac) and why a
 * line above 0 stays there.
 */

/** What a measurement of a call that keeps nothing may read: the agreement of `alloc` itself. */
export const NOISE_BYTES = 1;

/** Bytes per call each fixture may keep allocated. */
export const BUDGET = {
  /**
   * U1: the full hosting step of an idle frame, three hosts naming two world projections of 40
   * views each, and the slot of the inset. Was 29 087 B at HEAD (19 444 B once `world` kept its
   * key objects): a key object, an entry pair and a list of views per view, every frame. Now the
   * step compares two version numbers and walks nothing.
   */
  hostViewsIdle: 0,
  /**
   * U1, U2: `ui.reconcile` and `ui.solve` of an idle frame over ten roots, one of them in a slot.
   * Was 30 524 B at HEAD: the hosting step, a set and a filtered copy of the roots, two sets of
   * the solve, the slot's content box with its frame, the counters object, the viewport box, and
   * the closure context of the popup step. F23 (change 2026-10-18-hud-blink) adds one identity
   * compare of the layer list a frame, for the roots a new scene kept: still 0 B.
   */
  reconcileIdle: 0,
  /**
   * U3: a press and a release on one button of the 200-element board, each with the reconcile and
   * the solve of its frame. Was 872 602 B at HEAD: both frames re-ran the board's view and diffed
   * all of it. Now 3 849 B, the restyle of the one button, twice: its style resolved (a new
   * resolved style; LATER, a memo by style and flags), its visual and input values built and
   * written, its rest recorded with `world`, and its rest pose computed again (LATER, rects and
   * poses in place). The pressed look changes the fill only, so no motion starts. The line keeps
   * 50 B over the measure for the drift of two windows.
   */
  pressRelease: 3900,
  /**
   * The scroll step (change 2026-10-19-horizontal-scroll) over the order strip, an x scroll of
   * 306 u, while the finger holds it and moves 3.7 u a frame: the sample into the ring, the
   * follow, and `Scroll`, `ScrollState` and the content's `Transform` written. 0 B: the patches
   * are kept in the layout state and every number written is a whole unit, so `Object.assign`
   * boxes none; the exact offset stays on the element's motion record.
   */
  scrollHeld: 0,
  /** The same strip flinging at 1.3 u a ms, a 16.7 ms frame: the decay and the three writes. 0 B. */
  scrollFling: 0,
  /** The same strip in a glide from 900 to 1100 over 400 ms: the eased offset and the three writes. 0 B. */
  scrollGlide: 0,
  /** The same strip standing: one tag check and nothing written. 0 B. */
  scrollStill: 0,
  /**
   * F42 (change 2026-10-21-exit-restore-fixes): `still` of one leaving element per frame, three motions held, one of
   * them endless (a hot pulse). Was an `every` with an arrow; now an array `for…of` and a set lookup. 0 B.
   */
  exitStill: 0,
  /**
   * F48 (change 2026-10-21-hooks-after-sync): one element queued by its `Box` hook, then the system `ui.enter`
   * of phase `sync` drains the queue. The queue is one array emptied in place, walked by index. 0 B.
   */
  enterQueue: 0
} as const;
