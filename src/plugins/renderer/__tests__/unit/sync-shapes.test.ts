import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity, LayerSort } from "../../../world/types";
import { Parent, Shape, Sprite, Transform } from "../../components";
import type { FakeGraphics } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;
const anyEntity = (): boolean => true;

async function started(
  layers: Array<{ name: string; sort: LayerSort }> = [{ name: "items", sort: "none" }]
): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers(layers);
  mock.modules.sync.pass();

  return mock;
}

function graphicsOf(mock: MockRenderer, entity: Entity): FakeGraphics {
  const object = mock.ctx.state.sync.views.get(entity)?.object;

  if (object === undefined) throw new Error("the view is missing");

  return object as unknown as FakeGraphics;
}

describe("sync shapes", () => {
  it("draws the rounded rectangle once, and again only when the value changed", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 200, h: 100, radius: 12, fill: 0x10_20_30, alpha: 0.5 })
    ]);

    mock.modules.sync.pass();

    const graphics = graphicsOf(mock, entity);

    expect(mock.ctx.state.sync.views.get(entity)?.kind).toBe("Shape");
    expect(graphics.clears).toBe(1);
    expect(graphics.ops).toEqual([
      { op: "roundRect", x: 0, y: 0, width: 200, height: 100, radius: 12 }
    ]);
    expect(graphics.fills).toEqual([{ color: 0x10_20_30 }]);
    expect(graphics.alpha).toBe(0.5);

    mock.world.clearChanges();
    mock.modules.sync.pass();

    expect(graphics.clears).toBe(1);

    mock.world.ecs.set(entity, Shape, { fill: 0x00_ff_00 });
    mock.modules.sync.pass();

    expect(graphics.clears).toBe(2);
    expect(graphics.fills).toEqual([{ color: 0x00_ff_00 }]);
  });

  it("draws a plain rectangle without a radius and strokes only when asked", async () => {
    const mock = await started();
    const plain = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 64, h: 32 })
    ]);
    const outlined = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 64, h: 32, stroke: 0xff_00_00, strokeWidth: 4 })
    ]);

    mock.modules.sync.pass();

    expect(graphicsOf(mock, plain).ops[0]?.op).toBe("rect");
    expect(graphicsOf(mock, plain).strokes).toEqual([]);
    expect(graphicsOf(mock, outlined).strokes).toEqual([{ color: 0xff_00_00, width: 4 }]);
  });

  it("draws only the stroke of a shape whose fill alpha is 0", async () => {
    const mock = await started();
    const ring = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 140, h: 140, radius: 24, fillAlpha: 0, stroke: 0xff_c2_33, strokeWidth: 6 })
    ]);

    mock.modules.sync.pass();

    const graphics = graphicsOf(mock, ring);

    expect(graphics.ops).toEqual([
      { op: "roundRect", x: 0, y: 0, width: 140, height: 140, radius: 24 }
    ]);
    expect(graphics.fills).toEqual([]);
    expect(graphics.strokes).toEqual([{ color: 0xff_c2_33, width: 6 }]);
    expect(graphics.alpha).toBe(1);
  });

  it("fills with the fill alpha, apart from the alpha of the whole shape", async () => {
    const mock = await started();
    const glass = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 64, h: 32, fill: 0x10_20_30, fillAlpha: 0.5, alpha: 0.8 })
    ]);

    mock.modules.sync.pass();

    const graphics = graphicsOf(mock, glass);

    expect(graphics.fills).toEqual([{ color: 0x10_20_30, alpha: 0.5 }]);
    expect(graphics.alpha).toBe(0.8);

    mock.world.ecs.set(glass, Shape, { fillAlpha: 1 });
    mock.modules.sync.pass();

    expect(graphics.fills).toEqual([{ color: 0x10_20_30 }]);
  });

  it("draws a triangle pointing right that fills its box, whatever the radius", async () => {
    const mock = await started();
    const glyph = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ kind: "triangle", w: 60, h: 40, radius: 12, fill: 0xff_ff_ff })
    ]);

    mock.modules.sync.pass();

    const graphics = graphicsOf(mock, glyph);

    expect(graphics.ops.map(({ op, x, y }) => ({ op, x, y }))).toEqual([
      { op: "moveTo", x: 0, y: 0 },
      { op: "lineTo", x: 60, y: 20 },
      { op: "lineTo", x: 0, y: 40 },
      { op: "closePath", x: 0, y: 0 }
    ]);
    expect(graphics.fills).toEqual([{ color: 0xff_ff_ff }]);
    expect(mock.ctx.state.sync.views.get(glyph)?.hitBox).toEqual({
      x: 0,
      y: 0,
      width: 60,
      height: 40
    });
  });

  it("strokes a dashed rectangle as dash segments on a new path after the fill", async () => {
    const mock = await started();
    const box = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 100, h: 50, fill: 0x10_20_30, stroke: 0x3a_22_12, strokeWidth: 4, dash: 10 })
    ]);

    mock.modules.sync.pass();

    const graphics = graphicsOf(mock, box);
    const starts = graphics.ops.filter(entry => entry.op === "moveTo");

    expect(graphics.ops.slice(0, 2).map(entry => entry.op)).toEqual(["rect", "beginPath"]);
    expect(graphics.fills).toEqual([{ color: 0x10_20_30 }]);
    expect(graphics.strokes).toEqual([{ color: 0x3a_22_12, width: 4 }]);
    expect(starts).toHaveLength(20);
    expect(graphics.ops.slice(2, 4).map(({ op, x, y }) => ({ op, x, y }))).toEqual([
      { op: "moveTo", x: 0, y: 0 },
      { op: "lineTo", x: 10, y: 0 }
    ]);
    expect(starts.at(-1)).toMatchObject({ x: 0, y: 15 });
  });

  it("walks the sampled corners of a dashed rounded rectangle", async () => {
    const mock = await started();
    const ring = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({
        w: 100,
        h: 60,
        radius: 10,
        fillAlpha: 0,
        stroke: 0x3a_22_12,
        strokeWidth: 4,
        dash: 10
      })
    ]);

    mock.modules.sync.pass();

    const graphics = graphicsOf(mock, ring);
    const moves = graphics.ops.flatMap((entry, index) => (entry.op === "moveTo" ? [index] : []));
    const sixth = graphics.ops.slice(moves[5], moves[6]);

    expect(graphics.ops[0]).toEqual({
      op: "roundRect",
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      radius: 10
    });
    expect(graphics.ops[1]?.op).toBe("beginPath");
    expect(graphics.fills).toEqual([]);
    expect(graphics.strokes).toEqual([{ color: 0x3a_22_12, width: 4 }]);
    expect(moves).toHaveLength(21);
    expect(sixth[0]).toMatchObject({ op: "moveTo", x: 85, y: 0 });
    expect(sixth[1]).toMatchObject({ op: "lineTo", x: 90, y: 0 });
    expect(sixth.length).toBeGreaterThan(3);

    for (const point of sixth.slice(2)) {
      expect(Math.hypot(point.x - 90, point.y - 10)).toBeCloseTo(10, 0);
    }
  });

  it("draws no dashes when a dashed shape has no stroke width", async () => {
    const mock = await started();
    const plain = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 100, h: 50, dash: 10 })
    ]);

    mock.modules.sync.pass();

    expect(graphicsOf(mock, plain).ops.map(entry => entry.op)).toEqual(["rect"]);
    expect(graphicsOf(mock, plain).strokes).toEqual([]);
  });

  it("keeps the clip mask of a dashed shape solid", async () => {
    const mock = await started();
    const panel = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 100, h: 50, clip: true, stroke: 0x3a_22_12, strokeWidth: 4, dash: 10 })
    ]);

    mock.modules.sync.pass();

    const mask = mock.ctx.state.sync.views.get(panel)?.mask as unknown as FakeGraphics | undefined;

    expect(mask?.ops).toEqual([{ op: "rect", x: 0, y: 0, width: 100, height: 50, radius: 0 }]);
    expect(mask?.fills).toEqual([{ color: 0xff_ff_ff }]);
    expect(mask?.strokes).toEqual([]);
  });

  it("puts the hit box at the transform, anchored top left", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 100, y: 50 }),
      Shape({ w: 200, h: 100 })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.hitBox).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100
    });
    expect(mock.api.sync.hitTest(101, 51, anyEntity)).toBe(entity);
    expect(mock.api.sync.hitTest(299, 149, anyEntity)).toBe(entity);
    expect(mock.api.sync.hitTest(99, 51, anyEntity)).toBeUndefined();
    expect(mock.api.sync.hitTest(101, 151, anyEntity)).toBeUndefined();
  });

  it("masks the children of a clipping shape, and the mask follows the transform", async () => {
    const mock = await started();
    const panel = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 10, y: 20 }),
      Shape({ w: 100, h: 100, clip: true })
    ]);

    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(panel);
    const mask = view?.mask as unknown as FakeGraphics | undefined;

    expect(mask).toBeDefined();
    expect(mask?.ops).toEqual([{ op: "rect", x: 0, y: 0, width: 100, height: 100, radius: 0 }]);
    expect(view?.wrapper?.mask).toBe(view?.mask);
    expect(mask?.parent).toBe(view?.wrapper);
    expect(view?.wrapper?.position.x).toBe(10);

    mock.world.ecs.set(panel, Transform, { x: 42 });
    mock.modules.sync.pass();

    expect(view?.wrapper?.position.x).toBe(42);
    expect(mask?.parent).toBe(view?.wrapper);
  });

  it("fills the mask of a clipping shape whole, even when the shape draws only its stroke", async () => {
    const mock = await started();
    const frame = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 100, h: 100, clip: true, fillAlpha: 0, stroke: 0xff_c2_33, strokeWidth: 4 })
    ]);

    mock.modules.sync.pass();

    const mask = mock.ctx.state.sync.views.get(frame)?.mask as unknown as FakeGraphics | undefined;

    expect(graphicsOf(mock, frame).fills).toEqual([]);
    expect(mask?.fills).toEqual([{ color: 0xff_ff_ff }]);
  });

  it("drops the mask when clip is turned off", async () => {
    const mock = await started();
    const panel = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 100, h: 100, clip: true })
    ]);

    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(panel);
    const mask = view?.mask as unknown as FakeGraphics | undefined;

    mock.world.ecs.set(panel, Shape, { clip: false });
    mock.modules.sync.pass();

    expect(view?.mask).toBeUndefined();
    expect(view?.wrapper?.mask).toBeNull();
    expect(mask?.destroyed).toBe(true);
  });

  it("hits nothing inside a clipping ancestor when the point is outside its rect", async () => {
    const mock = await started();
    const panel = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 100, h: 100, clip: true })
    ]);

    mock.modules.sync.pass();

    const inside = mock.world.ecs.spawn(owner, [
      Transform({ x: 20, y: 20 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: panel })
    ]);
    const outside = mock.world.ecs.spawn(owner, [
      Transform({ x: 150, y: 20 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: panel })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(30, 30, anyEntity)).toBe(inside);
    expect(mock.api.sync.hitTest(160, 30, anyEntity)).toBeUndefined();
    expect(mock.ctx.state.sync.views.has(outside)).toBe(true);
  });

  it("keeps the sprite when an entity carries a shape too, and warns once", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" }),
      Shape({ w: 10, h: 10 })
    ]);

    mock.modules.sync.pass();

    const warnings = vi
      .mocked(mock.log.warn)
      .mock.calls.filter(([event]) => event === "renderer: entity has more than one visual");

    expect(mock.ctx.state.sync.views.get(entity)?.kind).toBe("Sprite");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.[1]).toEqual(
      expect.objectContaining({ entity, kinds: ["Sprite", "Shape"] })
    );
  });

  it("gives a shape back to its own pool and draws it again on reuse", async () => {
    const mock = await started();
    const first = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 10, h: 10 })
    ]);

    mock.modules.sync.pass();

    const graphics = graphicsOf(mock, first);

    mock.world.ecs.despawn(first);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.pools.get("Shape:")).toHaveLength(1);

    const second = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 20, h: 20 })
    ]);

    mock.modules.sync.pass();

    expect(graphicsOf(mock, second)).toBe(graphics);
    expect(graphics.ops).toEqual([{ op: "rect", x: 0, y: 0, width: 20, height: 20, radius: 0 }]);
  });
});
