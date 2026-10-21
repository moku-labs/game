/**
 * @file assets plugin — the heap budgets of the perf tests, in bytes per end of an exit, measured on Node 24
 * (`bun run test:perf`) in change 2026-10-21-enter-pose-bundle-hold. A line above 0 names its reason.
 */

/** The bytes per call the `alloc` helper itself tolerates (its own test of an empty function): every case adds it. */
export const NOISE = 1;

/** Bytes per end of an exit each fixture may keep allocated. */
export const BUDGET = {
  // No scene leaves: one length read.
  nothingLeaves: 0,
  // A scene leaves and an element still plays its exit: one count read.
  stillExiting: 0
} as const;
