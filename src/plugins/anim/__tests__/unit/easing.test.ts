import { describe, expect, it } from "vitest";
import type { Ease } from "../../../world/types";
import { applyEase, EASE_NAMES } from "../../tween/easing";

describe("anim/tween easing", () => {
  it("knows the nine named curves", () => {
    expect([...EASE_NAMES]).toEqual([
      "linear",
      "in",
      "out",
      "inOut",
      "inCubic",
      "outCubic",
      "inOutCubic",
      "inBack",
      "outBack"
    ]);
  });

  it("starts at 0 and lands on 1 for every named curve", () => {
    for (const name of EASE_NAMES) {
      expect(applyEase(name, 0)).toBeCloseTo(0, 10);
      expect(applyEase(name, 1)).toBeCloseTo(1, 10);
    }
  });

  it("eases the middle the way each curve is named", () => {
    expect(applyEase("linear", 0.5)).toBe(0.5);
    expect(applyEase("in", 0.5)).toBe(0.25);
    expect(applyEase("out", 0.5)).toBe(0.75);
    expect(applyEase("inOut", 0.5)).toBe(0.5);
    expect(applyEase("inCubic", 0.5)).toBe(0.125);
    expect(applyEase("outCubic", 0.5)).toBe(0.875);
    expect(applyEase("inOutCubic", 0.5)).toBe(0.5);
  });

  it("overshoots with the two back curves and still lands on 1", () => {
    expect(applyEase("inBack", 0.5)).toBeLessThan(0);
    expect(applyEase("outBack", 0.5)).toBeGreaterThan(1);
    expect(applyEase("outBack", 1)).toBeCloseTo(1, 10);
    expect(applyEase("inBack", 1)).toBeCloseTo(1, 10);
  });

  it("calls a function ease with the normalised time", () => {
    const seen: number[] = [];
    const ease: Ease = t => {
      seen.push(t);

      return t * 3;
    };

    expect(applyEase(ease, 0.25)).toBe(0.75);
    expect(seen).toEqual([0.25]);
  });
});
