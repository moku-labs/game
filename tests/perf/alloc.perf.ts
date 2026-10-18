import { describe, expect, it } from "vitest";
import { alloc } from "./alloc";

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
