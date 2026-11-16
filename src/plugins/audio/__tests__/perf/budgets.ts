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
  forgetLeft: 0
} as const;
