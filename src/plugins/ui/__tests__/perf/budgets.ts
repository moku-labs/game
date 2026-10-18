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
   * the closure context of the popup step.
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
  pressRelease: 3900
} as const;
