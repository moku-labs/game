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
  textResolveCountdown: 20,
  /**
   * F22: the step after the layout flush in a frame where no label came, over the 100 labels of
   * the idle fixture. New with change 2026-10-18-hud-blink: one length read of the list of the
   * labels that came, and nothing else.
   */
  textAddedIdle: 0,
  /**
   * F22: the idle phase in the frame after a flush whose step resolved the 20 bound labels: their
   * `Text` is written once more, with no field, so `ui` measures the string they show. New with
   * change 2026-10-18-hud-blink: one frozen empty patch for every write, nothing kept.
   */
  textRewrite: 0,
  /**
   * F50 (change 2026-10-21-text-wrap-box): the idle phase with the 80 plain labels in a style that
   * wraps at its box, each laid out at a box of its own. A label whose box stands costs one more
   * number compare and keeps nothing.
   */
  textResolveBoxIdle: 0,
  /**
   * F50: the display adapter's update of a `"box"` label written again with what it shows, as `ui`
   * writes a text whose rect moved and whose width stood. `isCurrent` compares the box as one more
   * number; nothing is laid out or kept.
   */
  textAdapterCurrent: 0,
  /**
   * F135 (change 2026-11-01-f135-bound-format): the idle phase with the 20 bound labels through a
   * format a feature registered. Reads and compares: the name read from the format table, one whole
   * value, the seen record. No key is built and the format is not called.
   */
  textNamedStanding: 0,
  /**
   * F135: the same phase with one counter moving under a format whose answer stands: one call, no
   * write. The format answers a kept object here, so what a game's format builds is not counted.
   */
  textNamedSameAnswer: 0,
  /**
   * F135: the same phase with one counter moving through a string of its own per value, the style
   * standing. Stays 80 B, the cost of one changed label, as `textResolveWorking`: the `{ resolved }`
   * patch and the layout cache key. A step that moves the style writes one more field.
   */
  textNamedChanged: 80
} as const;
