import { describe, expect, it } from "vitest";
import { alloc, WARM } from "./alloc";

/** Calls of a full window in the GC tests. */
const FULL = 10_000;

/** Calls of one window pair: the full window and its half. */
const PAIR = FULL + FULL / 2;

/**
 * A call that leaves one small object as garbage and runs a full GC on the measured calls `spoil` picks.
 *
 * @param spoil - Takes the measured call's index from 0, after the warm-up.
 * @returns The function to measure.
 */
function spoiling(spoil: (call: number) => boolean): () => void {
  const gc = globalThis.gc ?? (() => {});
  const kept = { last: { a: 0 } };
  let call = -WARM - 1;

  return () => {
    call++;
    kept.last = { a: call };
    if (call >= 0 && spoil(call)) gc();
  };
}

describe("alloc", () => {
  it("measures 0 bytes for a function that keeps nothing", () => {
    expect(alloc(() => {})).toBeLessThanOrEqual(1);
  });

  it("subtracts the window's own cost, also in a window of two calls", () => {
    expect(alloc(() => {}, 2)).toBeLessThanOrEqual(1);
  });

  it("measures the 30-element array a spread allocates", () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    let kept: number[] = [];
    const bytes = alloc(() => {
      kept = [...items];
    });

    expect(kept).toHaveLength(30);
    expect(bytes).toBeGreaterThanOrEqual(270);
    expect(bytes).toBeLessThanOrEqual(310);
  });

  it("still measures the real size of a function that allocates on every call", () => {
    const items = Array.from({ length: 30 }, (_, index) => index);
    let kept: number[] = [];
    const bytes = alloc(() => {
      kept = [...items];
    }, 4000);

    expect(kept).toHaveLength(30);
    expect(bytes).toBeGreaterThanOrEqual(270);
    expect(bytes).toBeLessThanOrEqual(310);
  });

  it("measures a kept {a,b} object that inlining would hide", () => {
    let index = 0;
    let kept = { a: 0, b: 0 };
    const bytes = alloc(() => {
      index++;
      kept = { a: index, b: index };
    });

    expect(kept.a).toBeGreaterThan(0);
    expect(bytes).toBeGreaterThan(0);
  });

  // Bug (CI, world changes.perf): two windows in a row with a GC inside threw, although later windows were sound.
  it("measures again past windows a GC landed in", () => {
    // The first two full windows get a GC at their 9 000th call: a window pair is 10 000 + 5 000 calls.
    const bytes = alloc(
      spoiling(call => call === 9000 || call === PAIR + 9000),
      FULL
    );

    expect(bytes).toBeGreaterThanOrEqual(12);
    expect(bytes).toBeLessThanOrEqual(40);
  });

  it("throws when no window is sound, a GC inside every full one", () => {
    expect(() =>
      alloc(
        spoiling(call => call % PAIR === 9000),
        FULL
      )
    ).toThrow("alloc: a GC inside the window");
  });

  it("throws without an exposed gc", () => {
    const gc = globalThis.gc;
    globalThis.gc = undefined;
    try {
      expect(() => alloc(() => {})).toThrow("alloc needs Node with --expose-gc");
    } finally {
      globalThis.gc = gc;
    }
  });
});
