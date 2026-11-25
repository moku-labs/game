/**
 * @file audio plugin — the heap budgets of the perf tests, in bytes per call, measured on Node 24
 * (`bun run test:perf`) in change 2026-11-16-f198-music-one-decoded. A line above 0 names its reason.
 */

/** The bytes per call the `alloc` helper itself tolerates (its own test of an empty function): every case adds it. */
export const NOISE = 1;

/** Bytes per call each fixture may keep allocated. */
export const BUDGET = {
  // The left key is the track that plays: one string compare.
  forgetPlaying: 0,
  // The left key is dropped from the cache. The fixture's put-back makes V8's Map churn its table (about 150 B per
  // set and delete, measured by the control); the budget is what the drop adds on top: nothing.
  forgetLeft: 0,
  // F239, change 2026-11-24-f239-loop-sfx, measured 2026-11-25 on Node 24 (a Mac, `bun run test:perf`): every line
  // below at 0 B, the control of `leaveTwoLoops` at 304 B and the leave itself at 304 B. Benches of the same build
  // (`bun run bench:perf`, `loops.bench.ts`): 23.9 M calls/s for an empty map, 17.8 M/s for two loops of another
  // scene, 4.78 M/s for two loops stopped and put back (control 6.98 M/s), 19.5 M/s for `isSameLoop`. Neither
  // function runs per frame: one walk per `scenes:changed`, one check per loop request.
  // The leave of a scene with an empty map of loops: one size check.
  leaveWithoutLoops: 0,
  // The walk over two loops of another scene: two scene compares, nothing stopped.
  leaveOtherScene: 0,
  // Two loops of the leaving scene fade out and leave both maps (`stopNamed` makes no nodes). The fixture's put-back
  // makes V8's Maps churn their tables; the budget is what the stop adds on top of that control: nothing.
  leaveTwoLoops: 0,
  // A loop request for the bed that already plays under its id: one lookup and one string compare.
  sameLoop: 0
} as const;
