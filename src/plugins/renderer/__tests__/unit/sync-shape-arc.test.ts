import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Shape, type ShapeValue, Transform } from "../../components";
import { paintShape } from "../../sync/shape-path";
import type { PixiGraphics } from "../../types";
import { type FakeDrawOp, FakeGraphics } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test: the arc of a `Shape` (F30). Its geometry on a recording graphics, and how the sync draws it: once, again
// only when a field changed, never while it draws nothing.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

/** The slot timer's ring: a 100 × 100 box, a stroke of 10, so the circle has a radius of 45 around (50, 50). */
const RING: ShapeValue = {
  ...Shape.defaults,
  kind: "arc",
  w: 100,
  h: 100,
  stroke: 0xc8_a1_5a,
  strokeWidth: 10
};

/**
 * Paints an arc on a fresh recording graphics.
 *
 * @param patch - What differs from `RING`.
 * @returns The graphics.
 */
function painted(patch: Partial<ShapeValue>): FakeGraphics {
  const graphics = new FakeGraphics();

  paintShape(graphics as unknown as PixiGraphics, { ...RING, ...patch }, 0xff_ff_ff);

  return graphics;
}

/**
 * The points of the path, in order: where it starts and every point a line goes to.
 *
 * @param graphics - The graphics.
 * @returns The points.
 */
function pointsOf(graphics: FakeGraphics): FakeDrawOp[] {
  return graphics.ops.filter(entry => entry.op === "moveTo" || entry.op === "lineTo");
}

/**
 * Starts the mock renderer with one layer.
 *
 * @returns The started renderer, its first pass run.
 */
async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

/**
 * The recording graphics of an entity's view.
 *
 * @param mock - The started renderer.
 * @param entity - The entity.
 * @returns Its graphics.
 */
function graphicsOf(mock: MockRenderer, entity: Entity): FakeGraphics {
  const object = mock.ctx.state.sync.views.get(entity)?.object;

  if (object === undefined) throw new Error("the view is missing");

  return object as unknown as FakeGraphics;
}

describe("the geometry of an arc", () => {
  // Bug: the arc starts at 3 o'clock (angle 0), runs counter-clockwise, or ignores the stroke width and leaves the box.
  it("strokes a quarter from 12 o'clock to 3 o'clock, clockwise, on the circle inside the stroke", () => {
    const graphics = painted({ sweep: 0.25 });
    const points = pointsOf(graphics);

    expect(points[0]).toMatchObject({ op: "moveTo", x: 50, y: 5 });
    expect(points.at(-1)?.x).toBeCloseTo(95);
    expect(points.at(-1)?.y).toBeCloseTo(50);
    // Clockwise on screen: from the top the path goes right and down.
    expect(points[1]?.x).toBeGreaterThan(50);

    for (const point of points) expect(Math.hypot(point.x - 50, point.y - 50)).toBeCloseTo(45);

    expect(graphics.ops.some(entry => entry.op === "closePath")).toBe(false);
    expect(graphics.strokes).toEqual([{ color: 0xc8_a1_5a, width: 10, cap: "round" }]);
  });

  // Bug: an arc is filled, rounded or dashed like a rectangle.
  it("draws only its stroke: fill, radius and dash are ignored", () => {
    const graphics = painted({ sweep: 0.5, fill: 0x10_20_30, fillAlpha: 1, radius: 12, dash: 6 });

    expect(graphics.fills).toEqual([]);
    expect(new Set(graphics.ops.map(entry => entry.op))).toEqual(new Set(["moveTo", "lineTo"]));
    expect(graphics.strokes).toHaveLength(1);
  });

  // Bug: a sweep of 0, or one below it, draws a dot or a backwards arc.
  it.each([0, -0.3, Number.NaN])("draws nothing at sweep %s", sweep => {
    const graphics = painted({ sweep });

    expect(graphics.ops).toEqual([]);
    expect(graphics.strokes).toEqual([]);
  });

  // Bug: a full ring is left open with two round ends meeting at 12 o'clock, a sweep above 1 draws past the circle, or
  // an arc whose Shape leaves `sweep` out (a whole ring) draws nothing.
  it.each([
    ["1", { sweep: 1 }],
    ["1.7", { sweep: 1.7 }],
    ["left out", {}]
  ] as const)("closes a full ring with no ends at sweep %s", (_name, patch) => {
    const graphics = painted(patch);
    const points = pointsOf(graphics);

    expect(points).toHaveLength(48);
    expect(graphics.ops.at(-1)?.op).toBe("closePath");
    expect(points.slice(1).some(point => point.x === 50 && point.y === 5)).toBe(false);
    expect(graphics.strokes).toEqual([{ color: 0xc8_a1_5a, width: 10 }]);
  });

  // Bug: the arc is always drawn with round ends.
  it("ends an open arc flat with cap butt", () => {
    expect(painted({ sweep: 0.42, cap: "butt" }).strokes).toEqual([
      { color: 0xc8_a1_5a, width: 10, cap: "butt" }
    ]);
  });

  // Bug: the circle fills the longer side and leaves a box that is not square, or is not centred in it.
  it("runs on the circle inscribed in the shorter side of a box that is not square, centred", () => {
    const points = pointsOf(painted({ w: 120, h: 60, strokeWidth: 4, sweep: 0.5 }));

    expect(points[0]).toMatchObject({ x: 60, y: 2 });
    expect(points.at(-1)?.x).toBeCloseTo(60);
    expect(points.at(-1)?.y).toBeCloseTo(58);
  });

  // Bug: a short arc is drawn with as many segments as a ring (wasted vertices), or a sliver as one straight chord.
  it("gives an arc segments in proportion to its angle, at least two", () => {
    expect(pointsOf(painted({ sweep: 0.25 }))).toHaveLength(13);
    expect(pointsOf(painted({ sweep: 0.001 }))).toHaveLength(3);
  });
});

describe("the sync of an arc", () => {
  // Bug: a still arc is built again every frame, or a change of its sweep or its ends is never drawn.
  it("draws an arc once, not again for its alpha, and once more for a new sweep or a new cap", async () => {
    const mock = await started();
    const timer = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ ...RING, sweep: 0.42 })
    ]);

    mock.modules.sync.pass();

    const graphics = graphicsOf(mock, timer);

    expect(graphics.clears).toBe(1);

    mock.world.clearChanges();
    mock.modules.sync.pass();
    mock.world.ecs.set(timer, Shape, { alpha: 0.5 });
    mock.modules.sync.pass();

    expect(graphics.clears).toBe(1);
    expect(graphics.alpha).toBe(0.5);

    mock.world.ecs.set(timer, Shape, { sweep: 0.5 });
    mock.modules.sync.pass();
    mock.modules.sync.pass();

    expect(graphics.clears).toBe(2);
    expect(pointsOf(graphics).at(-1)?.y).toBeCloseTo(95);

    mock.world.ecs.set(timer, Shape, { cap: "butt" });
    mock.modules.sync.pass();

    expect(graphics.clears).toBe(3);
    expect(graphics.strokes).toEqual([{ color: 0xc8_a1_5a, width: 10, cap: "butt" }]);
  });

  // Bug: an arc that draws nothing (sweep 0, no stroke width) stays in Pixi's build, or stays out of it once it draws.
  it("takes an arc that draws nothing out of the build, and puts it back when it sweeps again", async () => {
    const mock = await started();
    const timer = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ ...RING, sweep: 0 })
    ]);

    mock.modules.sync.pass();

    const graphics = graphicsOf(mock, timer);

    expect(graphics.renderable).toBe(false);

    mock.world.ecs.set(timer, Shape, { sweep: 0.3 });
    mock.modules.sync.pass();

    expect(graphics.renderable).toBe(true);
    expect(pointsOf(graphics).length).toBeGreaterThan(0);

    mock.world.ecs.set(timer, Shape, { strokeWidth: 0 });
    mock.modules.sync.pass();

    expect(graphics.renderable).toBe(false);
  });

  // Bug: the mask of a clipping arc is the arc's stroke path, or a rectangle rounded by the radius an arc ignores.
  it("clips the children of an arc to its box", async () => {
    const mock = await started();
    const frame = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ ...RING, w: 80, h: 60, radius: 12, clip: true, sweep: 0.5 })
    ]);

    mock.modules.sync.pass();

    const mask = mock.ctx.state.sync.views.get(frame)?.mask as unknown as FakeGraphics | undefined;

    expect(mask?.ops).toEqual([{ op: "rect", x: 0, y: 0, width: 80, height: 60, radius: 0 }]);
  });
});
