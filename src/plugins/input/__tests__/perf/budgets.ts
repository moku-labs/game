/**
 * @file input plugin — the heap budgets of the perf tests, in bytes per call, measured on Node 24 (`bun run
 * test:perf`) in change 2026-10-29-f122-lost-tap-log, `plainTap` in change 2026-11-04-f137-f139-answer-at-point. A
 * line above 0 names its reason.
 */

/** The bytes per call the `alloc` helper itself tolerates (its own test of an empty function): every case adds it. */
export const NOISE = 1;

/** Bytes per call each fixture may keep allocated, in a dev build. */
export const BUDGET = {
  // A tap the gate takes: the dev log of F122 reads nothing and builds nothing.
  takenAnswer: 0,
  // A paused frame with no press: the lost-press check runs every paused frame and keeps nothing.
  idleCheck: 0,
  // A press on a view that answers no tap, taken away: checked, not logged.
  untappedCheck: 0,
  // F139: the tap answer of a view without `point`, a point in hand. 40 B: the one answer object, kept, as before the
  // point existed (measured 40 B on the code before F139). No copy of the payload, no point object.
  plainTap: 40
} as const;
