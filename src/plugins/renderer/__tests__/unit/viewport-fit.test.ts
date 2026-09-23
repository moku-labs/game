import { describe, expect, it } from "vitest";
import { fitFrame, referenceOf, scaleOf } from "../../viewport/fit";

const aspect = { min: 4 / 3, max: 21 / 9 };
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

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

  it("scales by the short side when the long side has room", () => {
    expect(
      scaleOf({ x: 0, y: 0, width: 1080, height: 1920 }, "portrait", 1080, 1920, noInsets)
    ).toBe(1);
    expect(
      scaleOf({ x: 0, y: 0, width: 1920, height: 1080 }, "landscape", 1080, 1920, noInsets)
    ).toBe(1);
  });

  it.each([
    {
      screen: "390x844 phone: the width wins",
      frame: { x: 0, y: 0, width: 390, height: 844 },
      orientation: "portrait" as const,
      referenceLong: 1920,
      safe: noInsets,
      scale: 0.3611,
      reference: { width: 1080, height: 2337.2 }
    },
    {
      screen: "375x667 with a 20 px status bar: the height wins",
      frame: { x: 0, y: 0, width: 375, height: 667 },
      orientation: "portrait" as const,
      referenceLong: 2080,
      safe: { top: 20, right: 0, bottom: 0, left: 0 },
      scale: 0.3111,
      reference: { width: 1205.6, height: 2144.3 }
    },
    {
      screen: "768x1024 tablet: the height wins",
      frame: { x: 0, y: 0, width: 768, height: 1024 },
      orientation: "portrait" as const,
      referenceLong: 1920,
      safe: noInsets,
      scale: 0.5333,
      reference: { width: 1440, height: 1920 }
    },
    {
      screen: "667x375 landscape with a 20 px notch on the left: the mirror",
      frame: { x: 0, y: 0, width: 667, height: 375 },
      orientation: "landscape" as const,
      referenceLong: 2080,
      safe: { top: 0, right: 0, bottom: 0, left: 20 },
      scale: 0.3111,
      reference: { width: 2144.3, height: 1205.6 }
    }
  ])("fits both sides: $screen", ({
    frame,
    orientation,
    referenceLong,
    safe,
    scale,
    reference
  }) => {
    const found = scaleOf(frame, orientation, 1080, referenceLong, safe);
    const size = referenceOf(frame, found);

    expect(found).toBeCloseTo(scale, 4);
    expect(size.width).toBeCloseTo(reference.width, 1);
    expect(size.height).toBeCloseTo(reference.height, 1);
  });

  it("lets the reference short side grow on a wide screen", () => {
    const frame = { x: 555, y: 0, width: 810, height: 1080 };
    const scale = scaleOf(frame, "portrait", 1080, 1920, noInsets);

    expect(scale).toBeCloseTo(0.5625, 6);
    expect(referenceOf(frame, scale)).toEqual({ width: 1440, height: 1920 });
  });

  it("fits the short side alone when the insets leave no long side", () => {
    const frame = { x: 0, y: 0, width: 390, height: 844 };

    expect(
      scaleOf(frame, "portrait", 1080, 1920, { top: 500, right: 0, bottom: 400, left: 0 })
    ).toBeCloseTo(390 / 1080, 6);
    expect(scaleOf(frame, "portrait", 1080, 0, noInsets)).toBeCloseTo(390 / 1080, 6);
  });

  it("never divides by zero", () => {
    expect(scaleOf({ x: 0, y: 0, width: 0, height: 0 }, "portrait", 1080, 1920, noInsets)).toBe(1);
    expect(referenceOf({ x: 0, y: 0, width: 0, height: 0 }, 0)).toEqual({ width: 0, height: 0 });
  });
});
