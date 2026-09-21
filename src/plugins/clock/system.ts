/**
 * @file clock plugin — system time source skeleton. The one file allowed to read the device clock (lint L3).
 */
import type { ClockSource } from "./types";

/**
 * Creates the system source: epoch milliseconds from the device clock and real timers.
 *
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const source = systemSource();
 * const moment = source.now();
 * ```
 */
export function systemSource(): ClockSource {
  throw new Error("not implemented");
}
