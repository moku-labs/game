import { describe, expect, it } from "vitest";
import { sameValue } from "../../jsx/same";

// ---------------------------------------------------------------------------
// Unit: the comparison of two prop values of a description. Plain objects and
// arrays say the same when their content does; anything else is itself only.
// ---------------------------------------------------------------------------

/** A class of a game, as a value object a prop may hold. */
class Point {
  constructor(
    readonly x: number,
    readonly y: number
  ) {}
}

/** A hook built once, as a game keeps its hook tables. */
const hook = (): undefined => undefined;

/** Another hook with the same body: another function. */
const other = (): undefined => undefined;

describe("sameValue on plain data", () => {
  it("compares plain objects by value, however deep", () => {
    expect(sameValue({ gap: 8, padding: { top: 4 } }, { gap: 8, padding: { top: 4 } })).toBe(true);
    expect(sameValue({ gap: 8, padding: { top: 4 } }, { gap: 8, padding: { top: 5 } })).toBe(false);
    expect(sameValue({ gap: 8 }, { gap: 8, wrap: true })).toBe(false);
  });

  it("compares an array by value: the same entries in the same order", () => {
    expect(sameValue(["a", { n: 1 }], ["a", { n: 1 }])).toBe(true);
    expect(sameValue(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameValue(["a"], ["a", "b"])).toBe(false);
    expect(sameValue([], [])).toBe(true);
  });

  it("tells an array from an object with the same keys", () => {
    expect(sameValue(["a"], { 0: "a" })).toBe(false);
    expect(sameValue({ 0: "a" }, ["a"])).toBe(false);
  });

  it("compares an object without a prototype like a literal", () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { gap: 8 });

    expect(sameValue(bare, { gap: 8 })).toBe(true);
    expect(sameValue(bare, { gap: 9 })).toBe(false);
  });

  it("tells a missing key from another key that is undefined", () => {
    expect(sameValue({ a: undefined }, { b: undefined })).toBe(false);
    expect(sameValue({ a: undefined }, { a: undefined })).toBe(true);
  });

  it("takes NaN for the same as NaN, and 0 for the same as -0", () => {
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true);
    expect(sameValue({ value: Number.NaN }, { value: Number.NaN })).toBe(true);
    expect(sameValue(Number.NaN, 0)).toBe(false);
    expect(sameValue(0, -0)).toBe(true);
  });

  it("compares strings, numbers, booleans, null and undefined as they are", () => {
    expect(sameValue("a", "a")).toBe(true);
    expect(sameValue("1", 1)).toBe(false);
    expect(sameValue(true, false)).toBe(false);
    // eslint-disable-next-line unicorn/no-null -- the rule under test is how null compares.
    expect(sameValue(null, null)).toBe(true);
    // eslint-disable-next-line unicorn/no-null -- the rule under test is how null compares.
    expect(sameValue(null, {})).toBe(false);
    // eslint-disable-next-line unicorn/no-null -- the rule under test is how null compares.
    expect(sameValue(undefined, null)).toBe(false);
    expect(sameValue(undefined, undefined)).toBe(true);
  });
});

describe("sameValue on anything that is no plain data", () => {
  it("compares a Set by identity: two sets are never the same, whatever they hold", () => {
    const picked = new Set(["a"]);

    expect(sameValue(picked, picked)).toBe(true);
    expect(sameValue(new Set(["a"]), new Set(["a"]))).toBe(false);
    expect(sameValue(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
  });

  it("compares a Map by identity", () => {
    const looks = new Map([["a", 1]]);

    expect(sameValue(looks, looks)).toBe(true);
    expect(sameValue(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false);
  });

  it("compares a Date by identity", () => {
    const until = new Date(1000);

    expect(sameValue(until, until)).toBe(true);
    expect(sameValue(new Date(1000), new Date(2000))).toBe(false);
  });

  it("compares a class instance by identity, though its fields are equal", () => {
    const point = new Point(1, 2);

    expect(sameValue(point, point)).toBe(true);
    expect(sameValue(new Point(1, 2), new Point(1, 2))).toBe(false);
    expect(sameValue(new Point(1, 2), { x: 1, y: 2 })).toBe(false);
  });

  it("finds another Set nested inside a plain object or an array", () => {
    const picked = new Set(["a"]);

    expect(sameValue({ picked }, { picked })).toBe(true);
    expect(sameValue({ picked: new Set(["b"]) }, { picked: new Set(["a", "b"]) })).toBe(false);
    expect(sameValue([{ picked: new Set() }], [{ picked: new Set() }])).toBe(false);
  });

  it("compares a function by identity, also inside plain data", () => {
    expect(sameValue(hook, hook)).toBe(true);
    expect(sameValue(hook, other)).toBe(false);
    expect(sameValue({ change: { Box: hook } }, { change: { Box: hook } })).toBe(true);
    expect(sameValue({ change: { Box: hook } }, { change: { Box: other } })).toBe(false);
  });

  it("compares a typed array by identity", () => {
    expect(sameValue(new Uint8Array([1]), new Uint8Array([1]))).toBe(false);
  });
});
