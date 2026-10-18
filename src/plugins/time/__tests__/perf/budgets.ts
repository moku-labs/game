/**
 * @file time plugin — the heap budgets of the perf tests, in bytes per tick of the frame source, measured on Node 24.21
 * (`bun run test:perf`) in change 2026-10-18-memory-render (B2). A line above 0 names its reason.
 */

/** The bytes per call the `alloc` helper itself tolerates (its own test of an empty function): every case adds it. */
export const NOISE = 1;

/** Bytes per tick each fixture may keep allocated. */
export const BUDGET = {
  // B2: new. A steady screen at the top of the ladder and of the scale: the governor judges every interval and finds
  // nothing to raise.
  tickSteady: 0,
  // B2: new. A GPU-bound screen at the floor of the rate and of the scale, every other interval late: the rule wants
  // to drop and has no step left.
  tickLateAtFloor: 0
} as const;
