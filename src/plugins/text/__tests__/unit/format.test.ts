import { describe, expect, it } from "vitest";
import { formatBound, isTextFormat, pad2 } from "../../format";

// ---------------------------------------------------------------------------
// The four formats of a bound number, pure. The duration formatter is a fake
// that answers `${seconds}s`, so the case sees what i18n would be handed.
// ---------------------------------------------------------------------------

/**
 * The fake duration formatter: whole seconds and an `s`.
 *
 * @param ms - What `formatBound` handed it.
 * @returns The seconds as text.
 */
const seconds = (ms: number): string => `${ms / 1000}s`;

describe("pad2", () => {
  it("pads one digit to two and leaves longer numbers alone", () => {
    expect(pad2(5)).toBe("05");
    expect(pad2(0)).toBe("00");
    expect(pad2(42)).toBe("42");
    expect(pad2(100)).toBe("100");
  });
});

describe("formatBound — int", () => {
  it.each([
    [4.6, "5"],
    [12.4, "12"],
    [-0.4, "0"],
    [-3, "-3"]
  ])("shows %d as %s", (value, shown) => {
    expect(formatBound(value, "int", seconds)).toBe(shown);
  });

  it("shows a value that is not finite as 0", () => {
    expect(formatBound(Number.NaN, "int", seconds)).toBe("0");
    expect(formatBound(Number.POSITIVE_INFINITY, "int", seconds)).toBe("0");
  });
});

describe("formatBound — mm:ss", () => {
  it.each([
    [95_000, "01:35"],
    [94_001, "01:35"],
    [1, "00:01"],
    [0, "00:00"],
    [-5, "00:00"],
    [6_000_000, "100:00"]
  ])("shows %d ms as %s", (value, shown) => {
    expect(formatBound(value, "mm:ss", seconds)).toBe(shown);
  });

  it("shows NaN as zero time", () => {
    expect(formatBound(Number.NaN, "mm:ss", seconds)).toBe("00:00");
  });
});

describe("formatBound — h:mm:ss", () => {
  it.each([
    [3_661_000, "1:01:01"],
    [0, "0:00:00"],
    [59_999, "0:01:00"],
    [36_000_000, "10:00:00"],
    [-1000, "0:00:00"]
  ])("shows %d ms as %s", (value, shown) => {
    expect(formatBound(value, "h:mm:ss", seconds)).toBe(shown);
  });
});

describe("formatBound — duration", () => {
  it("hands the formatter whole seconds in milliseconds", () => {
    expect(formatBound(95_000, "duration", seconds)).toBe("95s");
    expect(formatBound(94_001, "duration", seconds)).toBe("95s");
    expect(formatBound(-5, "duration", seconds)).toBe("0s");
    expect(formatBound(Number.NaN, "duration", seconds)).toBe("0s");
  });

  it("never calls the formatter for another format", () => {
    let calls = 0;
    const counted = (ms: number): string => {
      calls += 1;

      return seconds(ms);
    };

    formatBound(95_000, "mm:ss", counted);
    formatBound(95_000, "h:mm:ss", counted);
    formatBound(95_000, "int", counted);

    expect(calls).toBe(0);
  });
});

describe("isTextFormat", () => {
  it("knows the four formats and nothing else", () => {
    expect(["int", "mm:ss", "h:mm:ss", "duration"].every(format => isTextFormat(format))).toBe(
      true
    );
    expect(isTextFormat("ss")).toBe(false);
    expect(isTextFormat("")).toBe(false);
  });
});
