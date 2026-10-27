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
   * F50 (change 2026-10-21-text-wrap-box): the same idle frame with eight more names that wrap at
   * the box their row leaves them, three lines each. Nothing is measured or solved again: 0 B.
   */
  reconcileBoxIdle: 0,
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
  enterQueue: 0,
  /**
   * Spec 31 (change 2026-10-25-f61-sliced-mount): `ui`'s part of a scene build, asked once a frame
   * while a build runs, over the ten roots at rest and no root built aside. Two flags a root, the
   * world asked about none. 0 B.
   */
  asideBuiltIdle: 0,
  /**
   * Spec 31: the same part while the names of the box files are built aside, solved: the world
   * asked about the one root that has work left, none. 0 B.
   */
  asideBuiltBuilding: 0,
  /**
   * Spec 31: `ui.enter` while every element of the names waits for the swap: each one looked up
   * in the world's build and written back in place in the queue. 0 B.
   */
  enterHeld: 0,
  /**
   * Spec 31: `ui.reconcile` and `ui.solve` of a frame while the names are built aside: the walk
   * that looks for a committed root asks the world about the one root built aside. 0 B.
   */
  reconcileBuilding: 0,
  /**
   * Spec 33 A (change 2026-10-25-f61-s3-big-mount): `ui.reconcile` and `ui.solve` of a frame while
   * the names are built aside and their parts are all made and applied: the drain walks the roots
   * and finds the names' queue empty, kept for reuse, and no application open. 0 B.
   */
  reconcileParked: 0,
  /** Spec 33 A: `ui`'s part of the same build, the empty queue and the closed application read. 0 B. */
  asideBuiltParked: 0,
  /**
   * Spec 33 A: `ui.reconcile` and `ui.solve` of an idle frame after a build in parts was committed:
   * no build runs, and the names' root keeps its empty queue. One number decides the drain and the
   * application step. 0 B.
   */
  reconcileAfterParts: 0,
  /**
   * F85 (change 2026-10-25-f83-f85-ui-exits-shape): the check every write of an element with a
   * `change` hook of its visual asks first, on each of the four visuals (the XP arc's `Shape`, a
   * coin `Sprite`, a panel `NineSlice`, a label `Text`, fractional numbers in all), none moved.
   * Its first form, one `for…in` over any value, kept 96 B on the arc alone: a generic read of a
   * fractional number boxes it, 16 B each. Each visual now has a comparator that reads its fields
   * by name, one shape of value per read site, so the numbers are compared unboxed. 0 B.
   */
  lookMoved: 0,
  /**
   * F85: ui's part of a render that moves the XP arc's sweep, its element hooked by `change.Shape`:
   * the look check, the values handed to the play (one object of the reconciler, filled in place)
   * and the notes of the pass. A numbers-only change writes no other fields, so no patch is built;
   * the hook's own motion is not in the window. 0 B.
   */
  lookWrite: 0,
  /**
   * F99 (change 2026-10-27-f99-f98-layout-guide): the system `ui.anchor` over two anchors whose
   * targets stand: the tutorial's window on a world sprite, and a window on a seat of the strip
   * inside a container drawn at half its size. Each target's root pose is walked into the anchor's
   * kept pose, the parent's pose mapped, the rest compared; nothing is written. 0 B.
   */
  anchorStill: 0,
  /**
   * F99: the same pass while the sprite moves between two fractional places, one a frame: the
   * window, its rim and its button take the new rects in place (`previous` by value), and the
   * window's `Box` and `Transform` and the children's `Box` are written field by field on the
   * stored values, which are only marked changed: no `ecs.set` with a patch of doubles, which
   * boxes 16 B a field. No Yoga run: the size stands. 0 B.
   */
  anchorMoving: 0,
  /**
   * F99 review: the same follow of a moving view by an anchor whose loop sways it forever (an
   * additive `x` track). The follow holds `x` and `y` from the loop once, when it starts moving
   * (`world.projection.mute`), and writes them in place every frame; the hold is let go in the
   * frame the anchor stands. Was a `setRest` and a 0 ms rest track every frame. 0 B.
   */
  anchorMovingLoop: 0
} as const;
