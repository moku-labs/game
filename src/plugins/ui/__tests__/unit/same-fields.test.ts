import { describe, expect, it } from "vitest";
import { sameValue } from "../../jsx/same";

// ---------------------------------------------------------------------------
// Unit: the edges of the plain-object and list compare of `sameValue` that its fast path walks (F244, slice 2):
// the keys of each side are walked once, counted, and a list is walked by index. Each case names a pair the fast
// path must not call equal: a prop the render dropped or added is a write the element needs.
// ---------------------------------------------------------------------------

/** A hook built once, as a game keeps its hook tables. */
const onTap = (): undefined => undefined;

/** Another hook with the same body: another function. */
const onPress = (): undefined => undefined;

describe("sameValue on the keys of two plain objects", () => {
  it("tells a key present with undefined on one side only from a key that is absent", () => {
    // Bug: reading `right[key]` for a missing key answers `undefined`, which equals the left's `undefined`: a prop
    // that stopped being written is told as the same, and its component keeps the old value.
    expect(sameValue({ gap: 8, wrap: undefined }, { gap: 8 })).toBe(false);
    expect(sameValue({ gap: 8 }, { gap: 8, wrap: undefined })).toBe(false);
    expect(sameValue({ wrap: undefined }, {})).toBe(false);
    expect(sameValue({}, { wrap: undefined })).toBe(false);
    // The same count of keys, the one that is undefined named otherwise: only a look at the key tells them.
    expect(sameValue({ gap: 8, wrap: undefined }, { gap: 8, pad: undefined })).toBe(false);
    expect(sameValue({ gap: 8, wrap: undefined }, { gap: 8, wrap: undefined })).toBe(true);
  });

  it("tells a key an Object.prototype member names from a key that is absent", () => {
    // Bug: a lookup that falls to the prototype finds `toString` and `constructor` on an object that lacks them.
    expect(sameValue({ toString: undefined }, {})).toBe(false);
    expect(sameValue({}, { constructor: undefined })).toBe(false);
    expect(sameValue({ gap: 8, toString: undefined }, { gap: 8, wrap: undefined })).toBe(false);
    expect(sameValue({ constructor: 1 }, { constructor: 1 })).toBe(true);
  });

  it("finds an extra key on either side, whatever order the keys come in", () => {
    // Bug: a walk of the left's keys alone calls `{ a }` and `{ a, b }` the same; a count that only closes one way
    // misses the other direction.
    expect(sameValue({ gap: 8 }, { gap: 8, wrap: true })).toBe(false);
    expect(sameValue({ gap: 8, wrap: true }, { gap: 8 })).toBe(false);
    expect(sameValue({ wrap: true, gap: 8 }, { gap: 8, wrap: true })).toBe(true);
    // The same count of keys, one of them another name.
    expect(sameValue({ gap: 8, wrap: true }, { gap: 8, pad: true })).toBe(false);
  });

  it("finds an extra key or a changed value one level down", () => {
    expect(
      sameValue({ is: { hover: { gap: 4 } } }, { is: { hover: { gap: 4, wrap: true } } })
    ).toBe(false);
    expect(sameValue({ is: { hover: { gap: 4 } } }, { is: { hover: { gap: 5 } } })).toBe(false);
    expect(sameValue({ is: { hover: { gap: 4 } } }, { is: { hover: { gap: 4 } } })).toBe(true);
  });
});

describe("sameValue on lists and on hooks inside plain data", () => {
  it("compares nested arrays entry by entry, at every depth and to the last entry", () => {
    // Bug: an index loop that stops at the first level, or before the last index, calls two lists the same.
    expect(sameValue([[1, [2, 3]], { k: [4] }], [[1, [2, 3]], { k: [4] }])).toBe(true);
    expect(sameValue([[1, [2, 3]], { k: [4] }], [[1, [2, 4]], { k: [4] }])).toBe(false);
    expect(sameValue([[1, [2, 3]], { k: [4] }], [[1, [2, 3]], { k: [5] }])).toBe(false);
    expect(sameValue([[1, [2, 3]]], [[1, [2, 3, 3]]])).toBe(false);
    expect(sameValue([[1, [2, 3]], 9], [[1, [2, 3]]])).toBe(false);
    expect(sameValue([[1], []], [[1], [undefined]])).toBe(false);
  });

  it("compares a function prop by identity, in a plain object and in a list", () => {
    // Bug: two hooks with one body, or two hooks under one key, called the same: a new hook would never be taken.
    expect(sameValue({ gap: 8, onTap }, { gap: 8, onTap })).toBe(true);
    expect(sameValue({ gap: 8, onTap }, { gap: 8, onTap: onPress })).toBe(false);
    expect(sameValue([onTap, onPress], [onTap, onPress])).toBe(true);
    expect(sameValue([onTap, onPress], [onPress, onTap])).toBe(false);
    expect(sameValue({ change: [{ Box: onTap }] }, { change: [{ Box: onPress }] })).toBe(false);
  });
});
