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
   * F148 (change 2026-11-04-f141-f147-f148-ui-text): the same idle phase with the 80 labels in a
   * box style that balances its lines. The search runs once per layout, on the cache miss; a frame
   * that lays nothing out reads the cache as the box style does and keeps nothing.
   */
  textResolveBalancedIdle: 0,
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
  textNamedChanged: 80,
  /**
   * F152 (change 2026-11-05-f152-text-runs): a still frame of phase `layout` over 50 labels of the
   * game's row, each laid out at its box, half with a `<b>` count in the bold look of `boldStyle`,
   * half with a price in a `<span>` of another style. The looks are built with the styles and the
   * layouts are cached, so a frame that lays nothing out keeps nothing.
   */
  textRunsIdle: 0,
  /**
   * F152 verify (change 2026-11-05-f152-text-runs): 50 bound labels of the game's row through a
   * format whose answer holds a `<b>` count in the bold look and a `<span>`, fonts loaded; one
   * counter moves every frame and its container is updated through the display adapter (a retext
   * of an unchanged shape). 328 B, all of it the text step: the `{ resolved }` patch (32 B) and the
   * one layout cache key of the long two-byte string. The draw keeps nothing: it takes the layout
   * the step kept for the label, walks the runs with the draw cursor (positions in a typed array,
   * no closure, spots by index), keeps run widths by run, and writes the new layout into the drawn
   * record. Was 1 720 B before this change (the draw path that predates F152).
   */
  textRunsMoving: 328,
  /**
   * The same frame with the answers as one run of the same words, no tag. 232 B, the patch and the
   * shorter key; the draw keeps nothing. Was 1 000 B.
   */
  textPlainMoving: 232
} as const;
