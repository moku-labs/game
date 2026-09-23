import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer, Order } from "../../../world/ecs/define";
import { NineSlice, Parent, Sprite, Transform } from "../../components";
import type { Config } from "../../types";
import { type FakeDrawOp, type FakeGraphics, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;
const CYAN = 0x00_ff_ff;
const RED = 0xff_00_00;

async function started(config: Partial<Config> = {}): Promise<MockRenderer> {
  const mock = createMockRenderer({ config });

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

/** The tray art of the fixture: insets 72 left and right, 76 top and bottom. */
function provideTray(mock: MockRenderer): void {
  const tray = new FakeTexture({
    source: { width: 300, height: 300, destroyed: false },
    defaultBorders: { left: 72, top: 76, right: 72, bottom: 76 }
  });

  mock.api.sync.textures.provide(key => (key === "board.board-tray" ? tray : undefined) as never);
}

function spawnNine(
  mock: MockRenderer,
  nine: Parameters<typeof NineSlice>[0] = {}
): { entity: number } {
  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform({ x: 40, y: 400 }),
    NineSlice({ texture: "board.board-tray", width: 1000, height: 1040, ...nine })
  ]);

  mock.modules.sync.pass();

  return { entity };
}

function outlineOf(mock: MockRenderer, entity: number): FakeGraphics | undefined {
  return mock.ctx.state.sync.views.get(entity)?.outline as unknown as FakeGraphics | undefined;
}

/** The x of every vertical slice line and the y of every horizontal one. */
function lines(ops: readonly FakeDrawOp[]): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];

  for (let at = 0; at < ops.length; at += 1) {
    const from = ops[at];
    const to = ops[at + 1];

    if (from?.op !== "moveTo" || to?.op !== "lineTo") continue;
    if (from.x === to.x) x.push(from.x);
    if (from.y === to.y) y.push(from.y);
  }

  return { x, y };
}

describe("sync nine-slice debug outline", () => {
  it("strokes the bounds and the four slice lines of a debug nine-slice in cyan", async () => {
    const mock = await started();

    provideTray(mock);

    const { entity } = spawnNine(mock, { debug: true });
    const view = mock.ctx.state.sync.views.get(entity);
    const outline = outlineOf(mock, entity);

    expect(outline?.parent).toBe(view?.wrapper);
    expect(outline?.label).toBe(`outline#${entity}`);
    expect(outline?.ops[0]).toEqual({
      op: "rect",
      x: 0,
      y: 0,
      width: 1000,
      height: 1040,
      radius: 0
    });
    expect(lines(outline?.ops ?? [])).toEqual({ x: [72, 928], y: [76, 964] });
    expect(outline?.strokes).toEqual([{ color: CYAN, width: 1, pixelLine: true }]);
    // The wrapper carries the pose; the outline sits in its local space.
    expect(view?.wrapper?.position.x).toBe(40);
    expect(view?.wrapper?.position.y).toBe(400);
  });

  it("draws nothing for a nine-slice without debug", async () => {
    const mock = await started();

    provideTray(mock);

    const { entity } = spawnNine(mock);

    expect(outlineOf(mock, entity)).toBeUndefined();
    expect(mock.ctx.state.sync.views.get(entity)?.wrapper).toBeUndefined();
  });

  it("turns red and shrinks the corners as Pixi does when they overlap", async () => {
    const mock = await started();

    provideTray(mock);

    const { entity } = spawnNine(mock, { debug: true, width: 100, height: 200 });
    const outline = outlineOf(mock, entity);
    const found = lines(outline?.ops ?? []);
    const s = 100 / 144;

    expect(found.x).toEqual([72 * s, 100 - 72 * s]);
    expect(found.y[0]).toBeCloseTo(76 * s, 6);
    expect(found.y[1]).toBeCloseTo(200 - 76 * s, 6);
    expect(outline?.strokes[0]?.color).toBe(RED);
  });

  it("turns red for a nine-slice whose texture is missing", async () => {
    const mock = await started();
    const { entity } = spawnNine(mock, { debug: true, texture: "ui.missing" });

    expect(outlineOf(mock, entity)?.strokes[0]?.color).toBe(RED);
  });

  it("redraws the same outline when the size changes", async () => {
    const mock = await started();

    provideTray(mock);

    const { entity } = spawnNine(mock, { debug: true });
    const outline = outlineOf(mock, entity);

    mock.world.ecs.set(entity, NineSlice, { width: 1200 });
    mock.modules.sync.pass();

    expect(outlineOf(mock, entity)).toBe(outline);
    expect(lines(outline?.ops ?? []).x).toEqual([72, 1128]);
  });

  it("destroys the outline when debug goes off", async () => {
    const mock = await started();

    provideTray(mock);

    const { entity } = spawnNine(mock, { debug: true });
    const outline = outlineOf(mock, entity);

    mock.world.ecs.set(entity, NineSlice, { debug: false });
    mock.modules.sync.pass();

    expect(outline?.destroyed).toBe(true);
    expect(outline?.parent).toBeNull();
    expect(outlineOf(mock, entity)).toBeUndefined();
  });

  it("destroys the outline when the view goes back to the pool", async () => {
    const mock = await started();

    provideTray(mock);

    const { entity } = spawnNine(mock, { debug: true });
    const outline = outlineOf(mock, entity);

    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(outline?.destroyed).toBe(true);
    expect(outline?.parent).toBeNull();
  });

  it("draws the outline above every child of the wrapper", async () => {
    const mock = await started();

    provideTray(mock);

    const { entity } = spawnNine(mock, { debug: true });
    const child = mock.world.ecs.spawn(owner, [
      Transform(),
      Sprite({ texture: "board.board-tray" }),
      Parent({ entity }),
      Order({ value: 1_000_000 })
    ]);

    mock.modules.sync.pass();

    const childObject = mock.ctx.state.sync.views.get(child)?.object;
    const outline = outlineOf(mock, entity);

    expect(childObject?.parent).toBe(outline?.parent);
    expect(outline?.zIndex ?? 0).toBeGreaterThan(childObject?.zIndex ?? 0);
  });

  it("goes with the whole tree when the renderer stops", async () => {
    const mock = await started();

    provideTray(mock);

    const { entity } = spawnNine(mock, { debug: true });
    const outline = outlineOf(mock, entity);

    mock.stop();

    expect(outline?.destroyed).toBe(true);
  });
});

describe("sync nine-slice debug switch", () => {
  it("outlines every nine-slice while the switch is on, and nothing else", async () => {
    const mock = await started();

    provideTray(mock);

    const { entity } = spawnNine(mock);
    const sprite = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "board.board-tray" })
    ]);

    mock.modules.sync.pass();
    mock.api.sync.debug.nineSlice(true);

    expect(mock.api.sync.debug.state()).toEqual({ nineSlice: true });

    mock.modules.sync.pass();

    expect(lines(outlineOf(mock, entity)?.ops ?? []).x).toEqual([72, 928]);
    expect(outlineOf(mock, sprite)).toBeUndefined();

    const outline = outlineOf(mock, entity);

    mock.api.sync.debug.nineSlice(false);
    mock.modules.sync.pass();

    expect(outline?.destroyed).toBe(true);
    expect(outlineOf(mock, entity)).toBeUndefined();
  });

  it("keeps the outline of a nine-slice that asks for it when the switch goes off", async () => {
    const mock = await started();

    provideTray(mock);

    const { entity } = spawnNine(mock, { debug: true });

    mock.api.sync.debug.nineSlice(true);
    mock.modules.sync.pass();
    mock.api.sync.debug.nineSlice(false);
    mock.modules.sync.pass();

    expect(outlineOf(mock, entity)?.destroyed).toBe(false);
  });

  it("starts on when the config says so", async () => {
    const mock = await started({ debug: { nineSlice: true } });

    provideTray(mock);

    const { entity } = spawnNine(mock);

    expect(mock.api.sync.debug.state()).toEqual({ nineSlice: true });
    expect(outlineOf(mock, entity)?.strokes[0]?.color).toBe(CYAN);
  });

  it("answers a fresh state object every call", async () => {
    const mock = await started();

    expect(mock.api.sync.debug.state()).toEqual({ nineSlice: false });
    expect(mock.api.sync.debug.state()).not.toBe(mock.api.sync.debug.state());
  });

  it("takes the switch while inert, with nothing to draw", async () => {
    const mock = createMockRenderer({ dom: false });

    await mock.start();
    mock.api.sync.debug.nineSlice(true);

    expect(mock.api.sync.debug.state()).toEqual({ nineSlice: true });
  });
});
