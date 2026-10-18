/**
 * @file effects plugin — the heap budgets of the perf tests, in bytes per frame step, measured on Node 24.21
 * (`bun run test:perf`). Each line says what the step measured before its fix (change 2026-10-18-cheap-idle-tick,
 * items E1 and E2) and what it holds now; a line above 0 names its reason.
 */

/** The bytes per call the `alloc` helper itself tolerates (its own test of an empty function): every case adds it. */
export const NOISE = 1;

/** Bytes per frame step each fixture may keep allocated. */
export const BUDGET = {
  // E1: 12 filtered views, nothing changed. Before: 4 610 B (every view synced every frame: entry pairs of the views
  // map, a `for…of` iterator over each frozen uniform list, a sort per view, the budget walk). Now 0: no view syncs.
  filtersIdle: 0,
  // E1: one `Glow` strength tweened on one of 12 filtered views, the tween's own write subtracted. Before: 4 698 B. Now
  // 0: one view syncs, its uniforms walked by index.
  filtersTween: 0,
  // Change 2026-10-18-memory-render, M4: the `Alpha` of one of 12 filtered views crosses 1 in every step, so its filter
  // is switched off and on and the view's area judged again, the fade's own write subtracted. Before: 16 B (the alpha
  // `numberOf` handed back and the keyed copy of the fields the setters were given each boxed a fraction; the switch
  // and the judged union added 32 B more while they were written the same way). Now 0: an `Alpha` reads and copies its
  // two fields by name, and a union of no area writes no numbers.
  filtersFade: 0,
  // E2: three local-space emitters following a still host, their streams held. Before: 890 B (a root pose and its
  // chain per emitter, the container's `Transform` written every frame, `[...orphans]`, the count's iterators, the
  // frame's delta boxed into each step call). Now 0: nothing is written for a still host.
  particlesStill: 0,
  // E2: the same three streams emitting. Before: 897 B. Now 0: a birth draws from a random source whose state is a
  // typed cell and whose step hands nothing back; a particle's colour is read from a baked table, not returned by a call.
  particlesEmitting: 0
} as const;
