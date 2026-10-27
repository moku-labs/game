/**
 * @file scenes plugin — the heap budgets of the perf tests, in bytes per call, measured on Node 24 (`bun run test:perf`)
 * in change 2026-10-25-f61-sliced-mount (S2). A line above 0 names its reason.
 */

/** The bytes per call the `alloc` helper itself tolerates (its own test of an empty function): every case adds it. */
export const NOISE = 1;

/** Bytes per call each fixture may keep allocated. */
export const BUDGET = {
  // The `signals` callback of a build that is not done: one counter step and one call of `built()`.
  buildWaiting: 0,
  // The `signals` callback of a switch that waits for its reaction frame (slice R): one flag read.
  reactionWaiting: 0
} as const;
