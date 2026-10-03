import { describe, expect, it } from "vitest";
import { compareJson, parseJson, stableJson } from "../../../src/visual/compare";

// ---------------------------------------------------------------------------
// Unit (pure): compareJson finds the path of the first difference; stableJson
// writes sorted keys with a two-space indent
// ---------------------------------------------------------------------------

describe("compareJson", () => {
  it("answers undefined for equal JSON", () => {
    // eslint-disable-next-line unicorn/no-null -- `null` is a JSON value a baseline holds.
    const value = { path: "home", player: { coins: 3, items: [1, 2, { id: "a" }] }, rng: null };

    expect(compareJson(value, structuredClone(value))).toBeUndefined();
    expect(compareJson([], [])).toBeUndefined();
    expect(compareJson("a", "a")).toBeUndefined();
  });

  it("names the first differing path in a nested object", () => {
    expect(compareJson({ player: { coins: 3 } }, { player: { coins: 4 } })).toBe("player.coins");
  });

  it("names an array index", () => {
    const expected = {
      ui: { children: [{ rect: { y: 1 } }, { rect: { y: 2 } }, { rect: { y: 3 } }] }
    };
    const actual = structuredClone(expected);

    actual.ui.children[2] = { rect: { y: 9 } };

    expect(compareJson(expected, actual)).toBe("ui.children[2].rect.y");
  });

  it("names a missing key on either side, and the first one in sorted order", () => {
    expect(compareJson({ a: 1, b: 2 }, { a: 1 })).toBe("b");
    expect(compareJson({ a: 1 }, { a: 1, c: 3 })).toBe("c");
    expect(compareJson({ b: 1, z: 1 }, { a: 1, z: 2 })).toBe("a");
  });

  it("names the first index past the shorter array", () => {
    expect(compareJson({ list: [1, 2] }, { list: [1, 2, 3] })).toBe("list[2]");
    expect(compareJson({ list: [1, 2, 3] }, { list: [1, 2] })).toBe("list[2]");
  });

  it("names a type change: object, array, null and a scalar differ", () => {
    expect(compareJson({ a: { b: 1 } }, { a: [1] })).toBe("a");
    // eslint-disable-next-line unicorn/no-null -- `null` is a JSON value a baseline holds.
    expect(compareJson({ a: null }, { a: {} })).toBe("a");
    expect(compareJson({ a: "1" }, { a: 1 })).toBe("a");
    expect(compareJson({ a: [] }, { a: {} })).toBe("a");
  });

  it("writes a key that is not an identifier in brackets", () => {
    expect(compareJson({ views: { "board.items": 1 } }, { views: { "board.items": 2 } })).toBe(
      'views["board.items"]'
    );
  });

  it("names the root when the two values differ at the top", () => {
    expect(compareJson(1, 2)).toBe("(root)");
    expect(compareJson({}, [])).toBe("(root)");
  });
});

describe("stableJson", () => {
  it("writes sorted keys with a two-space indent and a final newline", () => {
    expect(stableJson({ b: 1, a: { d: [2, 1], c: true } })).toBe(
      '{\n  "a": {\n    "c": true,\n    "d": [\n      2,\n      1\n    ]\n  },\n  "b": 1\n}\n'
    );
  });

  it("is stable whatever order the keys were written in", () => {
    expect(stableJson({ x: 1, y: { q: 1, p: 2 } })).toBe(stableJson({ y: { p: 2, q: 1 }, x: 1 }));
  });

  it("drops undefined fields, the way the file reads back", () => {
    expect(stableJson({ a: undefined, b: 1 })).toBe('{\n  "b": 1\n}\n');
  });
});

describe("parseJson", () => {
  it("reads back what stableJson wrote", () => {
    const value = { path: "home", player: { coins: 3 } };

    expect(parseJson(stableJson(value), "state.json")).toEqual(value);
  });

  it("refuses a file that is not JSON, naming it", () => {
    expect(() => parseJson("{ oops", "tests/visual/a/b/state.json")).toThrow(
      '[game] The baseline "tests/visual/a/b/state.json" is not JSON.\n  Fix the file, or write it again with --update.'
    );
  });
});
