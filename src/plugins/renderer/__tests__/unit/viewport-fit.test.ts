import { describe, expect, it } from "vitest";
import { fitFrame, referenceOf, scaleOf } from "../../viewport/fit";

const aspect = { min: 4 / 3, max: 21 / 9 };

describe("viewport fit", () => {
  it("puts bars left and right for a portrait game in a landscape window", () => {
    const frame = fitFrame({ width: 1920, height: 1080 }, aspect, "portrait");

    expect(frame).toEqual({ x: 555, y: 0, width: 810, height: 1080 });
  });

  it("uses the whole canvas when its ratio is inside the range", () => {
    expect(fitFrame({ width: 1080, height: 1920 }, aspect, "portrait")).toEqual({
      x: 0,
      y: 0,
      width: 1080,
      height: 1920
    });
  });

  it("puts bars top and bottom for a window taller than aspect.max", () => {
    const frame = fitFrame({ width: 1080, height: 3000 }, aspect, "portrait");

    expect(frame.width).toBe(1080);
    expect(frame.height).toBeCloseTo(2520, 6);
    expect(frame.y).toBeCloseTo(240, 6);
    expect(frame.x).toBe(0);
  });

  it("reads long and short the other way round for a landscape game", () => {
    expect(fitFrame({ width: 1920, height: 1080 }, aspect, "landscape")).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    });

    const square = fitFrame({ width: 1080, height: 1080 }, aspect, "landscape");

    expect(square.width).toBe(1080);
    expect(square.height).toBeCloseTo(810, 6);
    expect(square.y).toBeCloseTo(135, 6);
  });

  it("answers an empty frame for a canvas with no size", () => {
    expect(fitFrame({ width: 0, height: 0 }, aspect, "portrait")).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    });
  });

  it("scales by the short side of the designed orientation", () => {
    expect(scaleOf({ x: 555, y: 0, width: 810, height: 1080 }, "portrait", 1080)).toBeCloseTo(
      0.75,
      6
    );
    expect(scaleOf({ x: 0, y: 0, width: 1920, height: 1080 }, "landscape", 1080)).toBe(1);
  });

  it("keeps the reference short side at referenceSide", () => {
    const frame = { x: 555, y: 0, width: 810, height: 1080 };
    const scale = scaleOf(frame, "portrait", 1080);

    expect(referenceOf(frame, scale)).toEqual({ width: 1080, height: 1440 });
  });

  it("never divides by zero", () => {
    expect(scaleOf({ x: 0, y: 0, width: 0, height: 0 }, "portrait", 1080)).toBe(1);
    expect(referenceOf({ x: 0, y: 0, width: 0, height: 0 }, 0)).toEqual({ width: 0, height: 0 });
  });
});
