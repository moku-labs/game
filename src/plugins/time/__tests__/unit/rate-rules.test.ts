import { describe, expect, it } from "vitest";
import { DISPLAY_RATES, displayIndexOf, ladderOf, missLineMs, thermalOf } from "../../rate-rules";

// ---------------------------------------------------------------------------
// Unit: the pure rules of the adaptive frame rate (spec 21 G2): the ladder of
// a display, the rate a tick votes for, the late line, the thermal status.
// ---------------------------------------------------------------------------

describe("ladderOf", () => {
  it("keeps only the divisors between floor and maxFps, highest first", () => {
    expect(ladderOf(120, 120, 60)).toEqual([120, 60]);
    expect(ladderOf(60, 120, 60)).toEqual([60]);
    expect(ladderOf(144, 120, 60)).toEqual([72]);
    expect(ladderOf(90, 120, 30)).toEqual([90, 45, 30]);
    expect(ladderOf(240, 120, 60)).toEqual([120, 80, 60]);
  });

  it("keeps the highest divisor at or below maxFps alone when none reaches the floor", () => {
    expect(ladderOf(50, 120, 60)).toEqual([50]);
    expect(ladderOf(50, 30, 30)).toEqual([25]);
  });
});

describe("displayIndexOf", () => {
  it("matches a tick within 5 % of a rate's period and nothing between two rates", () => {
    const rateOf = (tickMs: number): number | undefined => DISPLAY_RATES[displayIndexOf(tickMs)];

    expect(rateOf(8.4)).toBe(120);
    expect(rateOf(8)).toBe(120);
    expect(displayIndexOf(7.8)).toBe(-1);
    expect(rateOf(16.9)).toBe(60);
    expect(rateOf(10.9)).toBe(90);
  });
});

describe("missLineMs", () => {
  it("is the frame plus half a display period", () => {
    expect(missLineMs(120, 120)).toBe(12.5);
    expect(missLineMs(60, 120)).toBeCloseTo(20.83, 2);
    expect(missLineMs(60, 60)).toBe(25);
  });
});

describe("thermalOf", () => {
  it("maps the status names and Android's numbers 0–6, and nothing else", () => {
    expect(thermalOf(2)).toBe("moderate");
    expect(thermalOf(0)).toBe("none");
    expect(thermalOf("severe")).toBe("severe");
    expect(thermalOf("hot")).toBeNull();
    expect(thermalOf(7)).toBeNull();
    expect(thermalOf(2.5)).toBeNull();
    expect(thermalOf(undefined)).toBeNull();
  });
});
