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
  // Change 2026-10-18-memory-render, M4: the `Alpha` of one of 12 filtered views touches 1 in every other step, the
  // fade's own write subtracted; its filter stays on (it is switched off only after `CALM_AFTER` syncs at 1). Before:
  // 16 B (the alpha `numberOf` handed back and the keyed copy of the fields the setters were given each boxed a
  // fraction). Now 0: an `Alpha` reads and copies its two fields by name.
  filtersFadeCrossing: 0,
  // M4: the same `Alpha` rests at 1 for `CALM_AFTER` steps, its view synced again each step, then its filter is
  // switched off, and a fraction switches it on again: the union of the view judged twice a round. New.
  filtersFadeResting: 0,
  // M4: an `Alpha` at resolution 0.5 fading between two fractions: its resolution is not written again. New.
  filtersFadeHalf: 0,
  // Change 2026-10-18-memory-render, B1: the apply of a backdrop without inputs in a drawn frame: `sampleBack`'s scale
  // and clamp compared with the back Pixi copied, then the body drawn. New.
  backdropApply: 0,
  // B1: the apply of a backdrop whose chain starts from back: three places drawn from the back into pooled textures,
  // the last one bound, the body drawn, the textures given back. Before the fix: 152 B, for any filter with inputs
  // (the list of taken textures cut with `length = 0` gave up its store, and the next apply grew a new one). Now 0.
  backdropChainApply: 0,
  // B1: the `spread` of a backdrop tweened, the tween's own write subtracted: its view synced, its slot compared (a
  // backdrop's chains are read for what the slot says it blurs). 16: the tweened fraction, boxed once when the sync
  // stores it in the uniform group, because here the stored value keeps it unboxed (the `Glow` case boxes it in the
  // write); a filter of ours that is no backdrop, of the same uniforms, measures the same 16. New.
  backdropTween: 16,
  // E2: three local-space emitters following a still host, their streams held. Before: 890 B (a root pose and its
  // chain per emitter, the container's `Transform` written every frame, `[...orphans]`, the count's iterators, the
  // frame's delta boxed into each step call). Now 0: nothing is written for a still host.
  particlesStill: 0,
  // E2: the same three streams emitting. Before: 897 B. Now 0: a birth draws from a random source whose state is a
  // typed cell and whose step hands nothing back; a particle's colour is read from a baked table, not returned by a call.
  particlesEmitting: 0
} as const;
