/**
 * @file clock plugin — fake time source for tests skeleton.
 */
import type { FakeClock } from "./types";

/**
 * Creates a fake source for tests. Timers fire synchronously inside `advance`, in due order.
 *
 * @param _start - Starting moment in epoch milliseconds. Defaults to 0.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const clock = fakeClock(1000);
 * clock.advance(5000);
 * ```
 */
export function fakeClock(_start?: number): FakeClock {
  throw new Error("not implemented");
}
