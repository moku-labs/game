/**
 * @file text plugin — the heap budgets of the perf tests, in bytes per frame. Each line says what
 * the frame kept before its fix (change 2026-10-18-cheap-idle-tick, item X1, Node 24.21 on the Mac)
 * and why a line above 0 stays there.
 */

/** What a measurement of a frame that keeps nothing may read: the agreement of `alloc` itself. */
export const NOISE_BYTES = 1;

/** Bytes per frame each fixture may keep allocated. */
export const BUDGET = {
  /**
   * X1: an idle layout phase over 100 labels, 20 bound, nothing changed. Was 4 000 B, some 40 B a
   * label: the destructured row, the bind key built twice per bound label, the context of the
   * duration closure per bound label.
   */
  textResolveIdle: 0,
  /**
   * X1: the same phase with one bound value moving every frame. Was 4 208 B. Stays 80 B, the cost
   * of one changed label: 32 B the `{ resolved }` patch `ecs.set` takes (world has no field
   * setter, and one kept patch would be the same object in every write a caller records), 48 B the
   * layout cache key `style + "\0" + resolved` (two joins; a cache keyed by style first removes it,
   * LATER with the text cache LRU). The shown digits come from V8's number-string cache here; a
   * string V8 has not cached adds its own bytes.
   */
  textResolveWorking: 80,
  /**
   * X1: the idle phase plus one countdown label, its clock moving 17 ms a frame. Was 4 247 B: the
   * idle cost, plus a boxed `until` and a boxed moment. Stays 20 B: 16 B the epoch moment
   * `clock.now()` answers, past the small-integer range and boxed on its way out of the clock
   * (clock's code, once a frame while a countdown label lives), and ~4 B the string of each new
   * second with its two patches and its key, spread over the 60 frames of the second.
   */
  textResolveCountdown: 20
} as const;
