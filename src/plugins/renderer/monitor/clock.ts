/**
 * @file renderer/monitor — the one renderer file that reads the page clock; lint L3 ignores it (eslint `ignores`). It
 * measures the page in agent builds: the agent phase, a line's `t`, an event's time between frames. Never a game's
 * state, whose time is `clock`.
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
