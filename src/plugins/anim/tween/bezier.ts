/**
 * @file anim/tween — the CSS timing function `cubic-bezier(x1, y1, x2, y2)` as an easing. The
 * curve is solved once, into a table of its progress at 512 even steps of time; a frame reads two
 * cells and draws a line between them. Where a line strays from the curve (the curve leaves an end
 * vertically), that step is solved again at each call, inside the bracket the table keeps. Either
 * way a call allocates nothing.
 */

/**
 * How many even steps of time the table splits 0…1 into. With 512, a line strays at most 1e-5
 * from any curve that keeps a finite slope (the CSS keywords, an overshoot both ways), so only a
 * curve that leaves an end vertically solves any step at a call; 8 KB per curve.
 */
const STEPS = 512;

/**
 * How far the line of a step may stray from the curve at the step's middle before that step is
 * solved at each call instead: a fifth of the 1e-4 the factory promises, so the rest of the step,
 * where the line may stray a little more, stays inside the promise too (2e-5 measured).
 */
const STRAY = 2e-5;

/** Halvings of a solve: 2^-48 of the bracket, far below what a double of progress shows. */
const HALVINGS = 48;

/**
 * A curve solved into its table. The control points stay in `points` for the steps solved at
 * each call. Plain typed arrays: a frame reads doubles out of them without boxing one.
 */
type BezierTable = {
  /** `[x1, y1, x2, y2]`. */
  readonly points: Float64Array;
  /** The curve parameter at each of the `STEPS + 1` even times. */
  readonly params: Float64Array;
  /** The progress at each of the `STEPS + 1` even times. */
  readonly progress: Float64Array;
  /** `1` for a step whose line strays from the curve: it is solved at each call. */
  readonly solved: Uint8Array;
};

/**
 * One coordinate of a cubic curve from 0 to 1 with the two inner control values. Pure.
 *
 * @param along - The curve parameter, 0 to 1.
 * @param first - The first control value.
 * @param second - The second control value.
 * @returns The coordinate at `along`.
 * @example
 * ```ts
 * coordinate(0.5, 1 / 3, 2 / 3); // 0.5: the middle of a straight line
 * ```
 */
function coordinate(along: number, first: number, second: number): number {
  const back = 1 - along;

  return (
    3 * back * back * along * first + 3 * back * along * along * second + along * along * along
  );
}

/**
 * The curve parameter whose x is `time`, found by halving a bracket of parameters. The x of the
 * curve never falls while x1 and x2 lie in 0…1, so halving always finds it. Pure.
 *
 * @param time - The x to reach.
 * @param x1 - The x of the first control point.
 * @param x2 - The x of the second control point.
 * @param low - A parameter whose x is at most `time`.
 * @param high - A parameter whose x is at least `time`.
 * @returns The parameter.
 * @example
 * ```ts
 * parameterAt(0.25, 0, 1, 0, 1); // 0.25: on a straight line the parameter is the time
 * ```
 */
function parameterAt(time: number, x1: number, x2: number, low: number, high: number): number {
  let from = low;
  let to = high;

  for (let step = 0; step < HALVINGS; step++) {
    const middle = (from + to) / 2;

    if (coordinate(middle, x1, x2) < time) from = middle;
    else to = middle;
  }

  return (from + to) / 2;
}

/**
 * Solves a curve into its table: the parameter and the progress at every even step of time, and
 * the steps whose line strays from the curve at their middle.
 *
 * @param points - `[x1, y1, x2, y2]`, x1 and x2 in 0…1.
 * @returns The table.
 */
function solveTable(points: Float64Array): BezierTable {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = points;
  const params = new Float64Array(STEPS + 1);
  const progress = new Float64Array(STEPS + 1);
  const solved = new Uint8Array(STEPS);

  for (let index = 1; index < STEPS; index++) {
    params[index] = parameterAt(index / STEPS, x1, x2, 0, 1);
    progress[index] = coordinate(params[index] ?? 0, y1, y2);
  }

  params[STEPS] = 1;
  progress[STEPS] = 1;

  for (let index = 0; index < STEPS; index++) {
    const middle = parameterAt(
      (index + 0.5) / STEPS,
      x1,
      x2,
      params[index] ?? 0,
      params[index + 1] ?? 1
    );
    const line = ((progress[index] ?? 0) + (progress[index + 1] ?? 0)) / 2;

    if (Math.abs(coordinate(middle, y1, y2) - line) > STRAY) solved[index] = 1;
  }

  return { points, params, progress, solved };
}

/**
 * The cell a solved step passes its time in and its progress out: a double handed to or returned
 * from a call V8 does not inline is boxed, a cell is not.
 */
const SOLVED = new Float64Array(1);

/**
 * The progress of a curve at one time: exactly 0 up to the start and 1 from the end on, a line
 * between two cells of the table in between, or the curve itself on a step whose line strays.
 *
 * @param table - The curve's table.
 * @param time - The time.
 * @returns The progress.
 */
function progressAt(table: BezierTable, time: number): number {
  if (time <= 0) return 0;
  if (time >= 1) return 1;

  const at = time * STEPS;
  const index = Math.floor(at);

  // per call: a line between two cells, no solve; a step the table marked solves the curve, its
  // numbers passed in a cell.
  if (table.solved[index] === 1) {
    SOLVED[0] = time;
    solveStep(table, index);

    return SOLVED[0] ?? 0;
  }

  const low = table.progress[index] ?? 0;

  return low + ((table.progress[index + 1] ?? 1) - low) * (at - index);
}

/**
 * The progress on a step whose line strays from the curve: the curve solved inside the bracket of
 * parameters the table keeps for that step. It reads the time from `SOLVED[0]` and leaves the
 * progress there. Kept apart so the common call stays small.
 *
 * @param table - The curve's table.
 * @param index - The step.
 */
function solveStep(table: BezierTable, index: number): void {
  const points = table.points;
  const along = parameterAt(
    SOLVED[0] ?? 0,
    points[0] ?? 0,
    points[2] ?? 0,
    table.params[index] ?? 0,
    table.params[index + 1] ?? 1
  );

  SOLVED[0] = coordinate(along, points[1] ?? 0, points[3] ?? 0);
}

/**
 * The CSS timing function `cubic-bezier(x1, y1, x2, y2)` as an easing a tween, a keyframe segment
 * or a motion takes for `ease`. The curve is solved once, here, into a table; a frame reads it, so
 * an eased time costs a few reads and allocates nothing, and the progress stays within 1e-4 of the
 * exact curve. It is exactly 0 up to the start and exactly 1 from the end on, and may leave 0…1 on
 * the way (an overshoot). Make each curve once, at module level, and share it.
 *
 * @param x1 - The x of the first control point, 0 to 1.
 * @param y1 - The y of the first control point; below 0 or above 1 overshoots.
 * @param x2 - The x of the second control point, 0 to 1.
 * @param y2 - The y of the second control point; below 0 or above 1 overshoots.
 * @returns The curve: normalised time in, eased progress out.
 * @throws {Error} When x1 or x2 lies outside 0…1: the curve would be no function of time.
 * @example
 * ```ts
 * // The design's arrival curve, made once and named by every tween that arrives.
 * const arrive = cubicBezier(0.22, 0.61, 0.36, 1);
 * arrive(0.5); // 0.873 (to 1e-4)
 * const drop = defineAnimation("card.drop", {
 *   slots: { card: type<Target>() },
 *   build: ({ card }) => sequence(tween(card, Transform, { y: 40 }, { ms: 300, ease: arrive }))
 * });
 * ```
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1)) {
    throw new Error(
      `[game] cubicBezier needs x1 and x2 between 0 and 1, got ${x1} and ${x2}.\n` +
        "  The x of a control point is a time; y1 and y2 may leave 0…1 for an overshoot."
    );
  }

  const table = solveTable(Float64Array.of(x1, y1, x2, y2));

  return (t: number): number => progressAt(table, t);
}
