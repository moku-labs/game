import { describe, expect, it } from "vitest";
import { Shape } from "../../components";
import { dashesOf, outlineOf } from "../../sync/shape-path";

// ---------------------------------------------------------------------------
// Unit test: the geometry of a shape outline and of its dashes.
// ---------------------------------------------------------------------------

describe("outlineOf", () => {
  it("walks a plain rectangle clockwise from the top left and closes it", () => {
    expect(outlineOf({ ...Shape.defaults, w: 100, h: 50 })).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
      { x: 0, y: 0 }
    ]);
  });

  it("walks a triangle pointing right and ignores the radius", () => {
    expect(outlineOf({ ...Shape.defaults, kind: "triangle", w: 60, h: 40, radius: 12 })).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 20 },
      { x: 0, y: 40 },
      { x: 0, y: 0 }
    ]);
  });

  it("samples every rounded corner on its arc", () => {
    const outline = outlineOf({ ...Shape.defaults, w: 100, h: 60, radius: 10 });
    const corner = outline.filter(point => point.x > 90 && point.y < 10);

    expect(outline[0]).toEqual({ x: 10, y: 0 });
    expect(outline.at(-1)?.x).toBeCloseTo(10);
    expect(outline.at(-1)?.y).toBeCloseTo(0);
    expect(corner.length).toBeGreaterThan(2);

    for (const point of corner) {
      expect(Math.hypot(point.x - 90, point.y - 10)).toBeCloseTo(10);
    }
  });

  it("clamps the radius to half of the shorter side", () => {
    const outline = outlineOf({ ...Shape.defaults, w: 100, h: 20, radius: 40 });

    expect(outline[0]).toEqual({ x: 10, y: 0 });
    expect(Math.max(...outline.map(point => point.y))).toBeCloseTo(20);
  });
});

describe("dashesOf", () => {
  it("cuts a line into dashes with gaps of half a dash", () => {
    expect(
      dashesOf(
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 }
        ],
        10
      )
    ).toEqual([
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 }
      ],
      [
        { x: 15, y: 0 },
        { x: 25, y: 0 }
      ],
      [
        { x: 30, y: 0 },
        { x: 40, y: 0 }
      ]
    ]);
  });

  it("bends a dash round a corner and keeps a short last dash", () => {
    expect(
      dashesOf(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 }
        ],
        6
      )
    ).toEqual([
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 }
      ],
      [
        { x: 9, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 }
      ],
      [
        { x: 10, y: 8 },
        { x: 10, y: 10 }
      ]
    ]);
  });

  it("repeats no point where a dash ends exactly on a corner", () => {
    const dashes = dashesOf(outlineOf({ ...Shape.defaults, w: 100, h: 50 }), 10);

    expect(dashes).toHaveLength(20);
    expect(dashes[6]).toEqual([
      { x: 90, y: 0 },
      { x: 100, y: 0 }
    ]);
    expect(dashes[7]).toEqual([
      { x: 100, y: 5 },
      { x: 100, y: 15 }
    ]);
  });

  it("draws no dash on an outline without length", () => {
    expect(dashesOf([{ x: 5, y: 5 }], 10)).toEqual([]);
    expect(dashesOf([], 10)).toEqual([]);
  });
});
