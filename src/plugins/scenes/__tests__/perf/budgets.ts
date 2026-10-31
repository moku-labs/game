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
  // The `signals` callback of a built scene a floor holds (F130): a clock read, a compare and a wake.
  buildHeld: 0,
  // The `signals` callback of a loader fading out with the veil after a swap (F107 part 3): a subtraction and a compare.
  loaderFading: 0,
  // The `assets:bundle-progress` hook of a switch that feeds its loader, below the step (F107 part 1): a lookup in the
  // table of the switch, a mean, a compare.
  progressBelowStep: 0
} as const;
