/**
 * @file renderer/monitor — the one renderer file that reads the page clock; lint L3 ignores it (eslint `ignores`). It
 * measures the page in agent builds: the agent phase, a line's `t`, an event's time between frames, and puts a
 * capture's picture in a page task after its frame. The run's trail (`trail.ts`, F175) also uses both, in every build:
 * the span of its frame counts and its write after a new rest path. Never a game's state, whose time is `clock`.
 */

/**
 * Reads `globalThis.performance.now()` at call time, so a test stubs it.
 *
 * @returns Page-clock milliseconds.
 */
export function pageNow(): number {
  return globalThis.performance.now();
}

/**
 * Turns page-clock milliseconds into page epoch milliseconds, `performance.timeOrigin + ms`, rounded to 0.01 ms: the
 * `t` of every log line.
 *
 * @param pageMs - Page-clock milliseconds.
 * @returns Epoch milliseconds.
 */
export function epochOf(pageMs: number): number {
  return Math.round((globalThis.performance.timeOrigin + pageMs) * 100) / 100;
}

/**
 * Runs work in a page task of its own, after the task running now (a frame) ends: `setTimeout` 0, which comes
 * before the next animation frame. For the page's own work (a capture's picture, the trail's write), never a game's
 * state.
 *
 * @param work - The work.
 * @example
 * ```ts
 * afterTask(() => takePicture()); // the frame ends first; the picture is its own task
 * ```
 */
export function afterTask(work: () => void): void {
  globalThis.setTimeout(work, 0);
}
