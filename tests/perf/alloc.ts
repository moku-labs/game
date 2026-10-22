import { getHeapStatistics } from "node:v8";

/** Calls before the measurement, so the function runs optimized and its caches are filled. */
export const WARM = 5000;

/** Measured windows; the smallest wins, so a one-off runtime event in one window is dropped. */
const ROUNDS = 3;

/** Windows tried for the 3 sound ones: a window a GC landed in is measured again, up to 12 in all. */
const ATTEMPTS = 12;

/** Bytes per call two sound windows may differ by, absolute. */
const AGREE_BYTES = 1;

/** Bytes per call two sound windows may differ by, relative to the larger one. */
const AGREE_SHARE = 0.02;

/**
 * Options for a plugin bench file: `bench(name, fn, BENCH_OPTIONS)`. A short run (200 ms after 50 ms of warm-up) keeps `bench:perf` fast.
 */
export const BENCH_OPTIONS = { time: 200, warmupTime: 50 } as const;

/** The control: a call that keeps nothing. */
const empty = (): void => {};

/**
 * The heap growth of one window: a full GC, then `calls` calls of `fn`.
 *
 * @param gc - The exposed garbage collector.
 * @param fn - The function to call.
 * @param calls - How many times to call it.
 * @returns The growth of `used_heap_size` in bytes.
 */
function heapGrowth(gc: () => void, fn: () => void, calls: number): number {
  gc();
  const before = getHeapStatistics().used_heap_size;
  for (let call = 0; call < calls; call++) fn();

  return getHeapStatistics().used_heap_size - before;
}

/**
 * The bytes per call of `fn` over `calls` calls, the empty control subtracted.
 *
 * @param gc - The exposed garbage collector.
 * @param fn - The function to measure.
 * @param calls - How many times to call it.
 * @returns Bytes per call.
 */
function perCall(gc: () => void, fn: () => void, calls: number): number {
  return (heapGrowth(gc, fn, calls) - heapGrowth(gc, empty, calls)) / calls;
}

/**
 * Whether two measurements of one function scale linearly, as they do without a GC inside.
 *
 * @param full - Bytes per call over the full window.
 * @param half - Bytes per call over the half window.
 * @returns True when they agree within 1 B or 2 %.
 */
function sound(full: number, half: number): boolean {
  const gap = Math.abs(full - half);

  return gap <= AGREE_BYTES || gap <= AGREE_SHARE * Math.max(Math.abs(full), Math.abs(half));
}

// Drive the call site in heapGrowth megamorphic, so V8 never inlines `fn` there and escape analysis cannot erase its objects.
const sink = { ticks: 0 };
const dummies: Array<() => void> = [
  () => {},
  () => {
    sink.ticks += 5;
  },
  () => {
    sink.ticks += 1;
  },
  () => {
    sink.ticks += 2;
  },
  () => {
    sink.ticks += 3;
  },
  () => {
    sink.ticks += 4;
  }
];
for (const dummy of dummies) heapGrowth(() => {}, dummy, 2000);

/**
 * Measures the heap bytes one call of `fn` keeps allocated, for a perf test's budget. The measuring
 * call site is made megamorphic at module load, so `fn` is never inlined there and the result is
 * what `fn` really allocates, whatever ran before it. Calls `fn`
 * 5 000 times to warm it up, then reads `used_heap_size` around `calls` calls after a full GC
 * and subtracts the same window of an empty function. A GC inside the window is caught by a
 * second window of `calls / 2`: the two must agree within 1 B or 2 % per call, else the window is
 * dropped and measured again, up to 12 windows in all, then it throws. 3 sound windows are
 * measured and the smallest result is returned: an allocation made on every call shows in all three, while a one-off runtime event
 * (a tier-up, a lazily allocated feedback vector, a deopt) lands in one window only and is
 * dropped by the minimum. Needs Node started with `--expose-gc` (the `perf` project of
 * vitest), never Bun.
 *
 * @param fn - The function to measure; it runs `5 000 + 9 × calls / 2` times or more.
 * @param calls - Calls in the full window.
 * @returns Bytes per call (smallest of 3 windows), the control subtracted; `0` or near it for a function that keeps nothing.
 * @throws {Error} "alloc needs Node with --expose-gc" under Bun or without an exposed `gc`.
 * @throws {Error} "alloc: a GC inside the window" when 12 windows give fewer than 3 sound ones.
 * @example
 * ```ts
 * const items = Array.from({ length: 30 }, (_, index) => index);
 * let kept: number[] = [];
 * alloc(() => {
 *   kept = [...items];
 * }); // ≈ 288: a 30-element array, kept until the next call replaces it
 * ```
 */
export function alloc(fn: () => void, calls = 10_000): number {
  const gc = globalThis.gc;
  if (process.versions.bun !== undefined || gc === undefined) {
    throw new Error("alloc needs Node with --expose-gc");
  }
  for (let call = 0; call < WARM; call++) fn();
  heapGrowth(gc, empty, WARM);

  let smallest = Number.POSITIVE_INFINITY;
  let found = 0;
  for (let attempt = 0; attempt < ATTEMPTS && found < ROUNDS; attempt++) {
    const full = perCall(gc, fn, calls);
    const half = perCall(gc, fn, Math.floor(calls / 2));
    if (!sound(full, half)) continue;
    found++;
    smallest = Math.min(smallest, full);
  }
  if (found < ROUNDS) throw new Error("alloc: a GC inside the window");

  return smallest;
}
