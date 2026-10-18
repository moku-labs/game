/**
 * @file clock plugin — the heap budgets of the perf tests, in bytes per read of `now()`, measured on Node 24.21
 * (`bun run test:perf`) in change 2026-10-18-cheap-idle-tick. A line above 0 names its reason.
 */

/** The bytes per call the `alloc` helper itself tolerates (its own test of an empty function): every case adds it. */
export const NOISE = 1;

/** Bytes per read each fixture may keep allocated. */
export const BUDGET = {
  // 16 B, all of it the device clock's: `Date.now()` alone keeps 16 B a read (V8 hands an epoch in milliseconds, far
  // outside its small integers, back as a new heap number). The clock's own code adds nothing (`stillNow`).
  systemNow: 16,
  // The clock's own code over a source that hands one constant moment: 0.
  stillNow: 0
} as const;
