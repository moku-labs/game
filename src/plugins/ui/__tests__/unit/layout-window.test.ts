import { describe, expect, it } from "vitest";
import { windowOf } from "../../layout/window";

// ---------------------------------------------------------------------------
// Unit test: the range of a windowed scroll, pure arithmetic over a fixed row
// height (rule 1 of 14-ui Delta 10 Part B)
// ---------------------------------------------------------------------------

describe("windowOf", () => {
  it.each([
    // offset, viewport, rows, row height, overscan, first, last
    ["the example of the spec", -3840, 1600, 1000, 120, 5, 27, 50],
    ["offset 0", 0, 1600, 1000, 120, 5, 0, 18],
    ["80 u rows at offset 0", 0, 1600, 1000, 80, 5, 0, 24],
    ["the end of the list", -118_400, 1600, 1000, 120, 5, 981, 999],
    ["overscan 0", -3840, 1600, 1000, 120, 0, 32, 45],
    ["a viewport taller than the list", 0, 1600, 10, 120, 5, 0, 9],
    ["one row", 0, 1600, 1, 120, 5, 0, 0]
  ])("%s", (_case, offset, viewport, rows, rowHeight, overscan, first, last) => {
    expect(windowOf(offset, viewport, rows, rowHeight, overscan)).toEqual({ first, last });
  });

  it("gives an empty range for an empty list", () => {
    expect(windowOf(0, 1600, 0, 120, 5)).toEqual({ first: 0, last: -1 });
  });

  it("holds about 24 rows for P18's list scrolled to its middle", () => {
    const { first, last } = windowOf(-3840, 1600, 1000, 120, 5);

    expect(last - first + 1).toBe(24);
  });
});
