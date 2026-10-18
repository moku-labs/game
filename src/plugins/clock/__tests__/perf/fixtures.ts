/**
 * @file clock plugin — the fixtures of the perf tests and benches. Not a test file. Each fixture builds a clock API
 * over its own state, outside any measured window, and hands back one read of `now()` the way `world` makes it every
 * frame: into the field of its `Now` resource.
 */
import { alloc } from "../../../../../tests/perf/alloc";
import { createClockApi } from "../../api";
import { systemSource } from "../../system";
import type { Api, ClockCtx, ClockSource } from "../../types";

/** Calls before a window: the read reaches its optimized tier first, as on a phone after a few seconds. */
const WARM_CALLS = 30_000;

/** Calls of a window, ten times `alloc`'s default. */
const CALLS = 100_000;

/** A moment of 2026 in epoch milliseconds: far outside the small integers V8 keeps unboxed. */
const EPOCH_MS = 1_790_000_000_000;

/**
 * The heap bytes one call of a read keeps: the read run until V8 optimized it, outside the window, then `alloc` over a
 * window of `CALLS`.
 *
 * @param fn - The read.
 * @returns Bytes per call.
 */
export function bytesPerCall(fn: () => void): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, CALLS);
}

/**
 * A clock API over a fresh state and `source`.
 *
 * @param source - The time source.
 * @returns The API.
 */
function clockOver(source: ClockSource): Api {
  const ctx: ClockCtx = {
    global: {},
    config: { source },
    state: { source, last: 0, dueAt: undefined, handle: undefined, listeners: [] },
    emit: () => {}
  };

  return createClockApi(ctx);
}

/**
 * A source that never moves: its `now()` hands out one constant moment, a number V8 made once, so a read counts the
 * bytes of the clock alone and none of the device clock's.
 *
 * @returns The source.
 */
function stillSource(): ClockSource {
  return {
    now: (): number => EPOCH_MS,
    setTimer: (): undefined => undefined,
    clearTimer: (): void => {}
  };
}

/** Where a fixture puts what it read: a field of a `Now`-like resource, as `world` writes it every frame. */
const readers = { now: 0 };

/**
 * One read of `now()` over the system source (`Date.now`), written into a resource field as `world` does.
 *
 * @returns The read.
 */
export function systemReadIntoField(): () => void {
  const clock = clockOver(systemSource());

  return (): void => {
    readers.now = clock.now();
  };
}

/**
 * One read of `now()` over a still source, written into a resource field: the clock's own bytes.
 *
 * @returns The read.
 */
export function stillReadIntoField(): () => void {
  const clock = clockOver(stillSource());

  return (): void => {
    readers.now = clock.now();
  };
}

/**
 * One read of the device clock itself, `Date.now()`, into a resource field: what the platform keeps per read.
 */
function readDateNow(): void {
  readers.now = Date.now();
}

/**
 * One read of the device clock itself, for a bench beside the clock's.
 *
 * @returns The read.
 */
export function dateNowIntoField(): () => void {
  return readDateNow;
}
