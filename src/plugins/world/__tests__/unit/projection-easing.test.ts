import { describe, expect, it } from "vitest";
import { applyEase } from "../../projection/easing";

// ---------------------------------------------------------------------------
// Unit test: applyEase (the four built-in curves and a custom function)
// ---------------------------------------------------------------------------

describe("applyEase", () => {
  it("leaves the fraction alone for linear", () => {
    expect(applyEase("linear", 0)).toBe(0);
    expect(applyEase("linear", 0.25)).toBe(0.25);
    expect(applyEase("linear", 1)).toBe(1);
  });

  it("starts slowly for in", () => {
    expect(applyEase("in", 0.5)).toBe(0.25);
    expect(applyEase("in", 1)).toBe(1);
    expect(applyEase("in", 0.25)).toBeLessThan(0.25);
  });

  it("ends slowly for out", () => {
    expect(applyEase("out", 0.5)).toBe(0.75);
    expect(applyEase("out", 1)).toBe(1);
    expect(applyEase("out", 0.25)).toBeGreaterThan(0.25);
  });

  it("is slow at both ends for inOut", () => {
    expect(applyEase("inOut", 0.25)).toBe(0.125);
    expect(applyEase("inOut", 0.5)).toBe(0.5);
    expect(applyEase("inOut", 0.75)).toBe(0.875);
    expect(applyEase("inOut", 1)).toBe(1);
  });

  it("calls a function ease as it is", () => {
    expect(applyEase(t => t * 3, 0.2)).toBeCloseTo(0.6);
  });
});
