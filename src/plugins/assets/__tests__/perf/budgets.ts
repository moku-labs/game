/**
 * @file assets plugin — the heap budgets of the perf tests, in bytes per call, measured on Node 24
 * (`bun run test:perf`) in change 2026-10-21-enter-pose-bundle-hold. A line above 0 names its reason.
 */

/** The bytes per call the `alloc` helper itself tolerates (its own test of an empty function): every case adds it. */
export const NOISE = 1;

/** Bytes per call each fixture may keep allocated. */
export const BUDGET = {
  // No scene leaves: one length read.
  nothingLeaves: 0,
  // A scene leaves and an element still plays its exit: one count read.
  stillExiting: 0,
  // A view asks for a key of a loaded bundle (F184, change 2026-11-15-f184-budget-drawn): a touch and two map reads.
  lookupHit: 0,
  // The look-ahead of one rest, a hub with six windows and the same committed state. Before F194 95 312 B: every
  // scene asked for its bundles again, the manifest scanned per node; after F194 17 to 18 KB, the walk itself. F196
  // keeps the walk for the next rest at the same place and filters into a scratch list: nothing.
  restLookAhead: 0,
  // A node entered while no `ready` ask waits (F204): one field read.
  readyNoAsk: 0,
  // The rest after a transit node's `ready` ask: the cached graph read and one `includes` (F204).
  readyRestWithoutReady: 0,
  // F202: the system `assets.ready` with no `ready` waiting for a warm view: one field read. New.
  readyRest: 0,
  // F202: the same while a `ready` waits for a build under its cap: `left()`, a clock read and a subtraction. New.
  readyWaiting: 0,
  // F230: the system `assets.preload` with no rest waiting for its walk: one field read. New.
  preloadRest: 0,
  // F230: the same while a rest waits for the world to rest, under its cap: `left()`, a clock read and a subtraction.
  preloadWaiting: 0
} as const;
