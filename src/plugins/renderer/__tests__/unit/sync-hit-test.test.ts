import { afterEach, describe, expect, it, vi } from "vitest";
import { Exiting, Layer, Order } from "../../../world/ecs/define";
import { Parent, Shape, Sprite, Transform } from "../../components";
import { FakeContainer, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;
const anyEntity = (): boolean => true;

async function started(
  layers: Array<{ name: string; sort: "none" | "y" | "order" }> = [{ name: "items", sort: "none" }]
): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  // A 64x64 texture, so a sprite with the default anchor covers -32..32.
  mock.api.sync.textures.provide(() => new FakeTexture({}) as never);
  mock.world.projection.setLayers(layers);
  mock.modules.sync.pass();

  return mock;
}

describe("sync hit test", () => {
  it("answers the entity under the point, in reference units", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 540, y: 300 }),
      Sprite({ texture: "board.cell" })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(540, 300, anyEntity)).toBe(entity);
    expect(mock.api.sync.hitTest(540, 300 + 31, anyEntity)).toBe(entity);
    expect(mock.api.sync.hitTest(540, 300 + 40, anyEntity)).toBeUndefined();
  });

  it("takes the last layer of the list first", async () => {
    const mock = await started([
      { name: "board", sort: "none" },
      { name: "items", sort: "none" }
    ]);

    mock.world.ecs.spawn(owner, [Layer({ name: "board" }), Transform(), Sprite({ texture: "a" })]);

    const top = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBe(top);
  });

  it("takes the higher zIndex inside a layer, then the later insertion", async () => {
    const mock = await started([{ name: "items", sort: "order" }]);

    mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" }),
      Order({ value: 5 })
    ]);

    const above = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" }),
      Order({ value: 9 })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBe(above);
  });

  it("skips what is hidden, fully transparent or detached", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(entity)?.object;

    if (object === undefined) throw new Error("the view is missing");

    object.visible = false;
    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBeUndefined();

    object.visible = true;
    object.alpha = 0;
    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBeUndefined();

    object.alpha = 1;
    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBe(entity);
  });

  it("moves the point through rotation and scale", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 100, y: 100, rotation: Math.PI / 2, scale: 2 }),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(100 + 60, 100, anyEntity)).toBe(entity);
    expect(mock.api.sync.hitTest(100 + 70, 100, anyEntity)).toBeUndefined();
  });

  it("moves the point through the parent chain", async () => {
    const mock = await started();
    const parent = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 200, y: 0 }),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    const child = mock.world.ecs.spawn(owner, [
      Transform({ x: 50, y: 0 }),
      Sprite({ texture: "a" }),
      Parent({ entity: parent })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(250, 0, anyEntity)).toBe(child);
    expect(mock.api.sync.hitTest(200, 0, anyEntity)).toBe(parent);
  });

  it("lets the caller reject an entity, and looks under it", async () => {
    const mock = await started();
    const below = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);
    const above = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.world.ecs.tag(above, Exiting);
    mock.modules.sync.pass();

    const live = (entity: number): boolean => !mock.world.ecs.has(entity, Exiting);

    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBe(above);
    expect(mock.api.sync.hitTest(0, 0, live)).toBe(below);
  });

  it("treats a scale of zero as one, so a collapsed view is still reachable", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 0, y: 0, scale: 0 }),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBe(entity);
  });

  it("stops a parent chain that points at itself", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 10, y: 0 }),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();
    mock.world.ecs.add(entity, Parent({ entity }));
    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(10, 0, anyEntity)).toBe(entity);
  });

  it("answers nothing for a tree that does not hang under the root", async () => {
    const mock = await started();

    mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite({ texture: "a" })]);
    mock.modules.sync.pass();

    mock.ctx.state.sync.root = new FakeContainer() as never;

    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBeUndefined();
  });

  it("answers nothing before a layer list exists", async () => {
    const mock = createMockRenderer();

    await mock.start();

    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBeUndefined();
  });

  it("adds the pivot when it moves the point into local space, with rotation and scale", async () => {
    const mock = await started();
    // Turned a quarter, doubled, turning around the right edge of its 64 x 64 box.
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 100, y: 100, rotation: Math.PI / 2, scale: 2, pivot: { x: 32, y: 0 } }),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    // The box now covers x 36..164 and y -28..100.
    expect(mock.api.sync.hitTest(100, 50, anyEntity)).toBe(entity);
    expect(mock.api.sync.hitTest(40, -20, anyEntity)).toBe(entity);
    expect(mock.api.sync.hitTest(100, 120, anyEntity)).toBeUndefined();
  });

  it("follows the pivots of a parent chain", async () => {
    const mock = await started();
    const parent = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 200, y: 0, pivot: { x: 50, y: 0 } }),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    const child = mock.world.ecs.spawn(owner, [
      Transform({ x: 50, y: 0, scale: 0.5, rotation: Math.PI, pivot: { x: 20, y: 0 } }),
      Sprite({ texture: "a" }),
      Parent({ entity: parent })
    ]);

    mock.modules.sync.pass();

    // The parent draws around 150, the child's pivot lands on 200 and its box spans 194..226.
    expect(mock.api.sync.hitTest(150, 0, anyEntity)).toBe(parent);
    expect(mock.api.sync.hitTest(220, 0, anyEntity)).toBe(child);
    expect(mock.api.sync.hitTest(250, 0, anyEntity)).toBeUndefined();
  });

  it("takes the child with the higher Order first inside a wrapper", async () => {
    const mock = await started();
    const parent = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    const above = mock.world.ecs.spawn(owner, [
      Transform(),
      Sprite({ texture: "a" }),
      Parent({ entity: parent }),
      Order({ value: 1 })
    ]);

    mock.world.ecs.spawn(owner, [
      Transform(),
      Sprite({ texture: "a" }),
      Parent({ entity: parent })
    ]);
    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBe(above);
  });

  it("tests the drawn box of a sized sprite", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 500, y: 500 }),
      Sprite({ texture: "a", width: 300, height: 100, fit: "contain", anchor: { x: 0, y: 0 } })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(790, 590, anyEntity)).toBe(entity);
    expect(mock.api.sync.hitTest(810, 550, anyEntity)).toBeUndefined();
  });
});

describe("sync hitAll", () => {
  it("lists every view under the point, topmost first", async () => {
    const mock = await started();
    const cell = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 540, y: 300 }),
      Sprite({ texture: "board.cell" })
    ]);

    // Four entities that draw nothing, so the coin gets index 5.
    for (let index = 0; index < 4; index += 1) mock.world.ecs.spawn(owner, [Transform()]);

    const coin = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 540, y: 300 }),
      Sprite({ texture: "board.coin" })
    ]);

    mock.modules.sync.pass();

    expect([cell, coin]).toEqual([1_048_576, 1_048_581]);
    expect(mock.api.sync.hitAll(540, 300)).toEqual([1_048_581, 1_048_576]);
    expect(mock.api.sync.hitAll(20, 20)).toEqual([]);
  });

  it("walks the layers from the last one, as hitTest does", async () => {
    const mock = await started([
      { name: "board", sort: "none" },
      { name: "items", sort: "none" }
    ]);
    const below = mock.world.ecs.spawn(owner, [
      Layer({ name: "board" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);
    const above = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitAll(0, 0)).toEqual([above, below]);
    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBe(above);
  });

  it("skips a hidden view and keeps the one below it", async () => {
    const mock = await started();
    const below = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);
    const hidden = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(hidden)?.object;

    if (object === undefined) throw new Error("the view is missing");

    object.visible = false;

    expect(mock.api.sync.hitAll(0, 0)).toEqual([below]);
  });

  it("skips a child outside the rectangle its clipping parent shows", async () => {
    const mock = await started();
    const panel = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 100, h: 100, clip: true })
    ]);

    mock.modules.sync.pass();

    // The row's box spans x 58..122; the panel shows its children inside x 0..100 only.
    const row = mock.world.ecs.spawn(owner, [
      Transform({ x: 90, y: 50 }),
      Sprite({ texture: "a" }),
      Parent({ entity: panel })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitAll(110, 50)).toEqual([]);
    expect(mock.api.sync.hitAll(95, 50)).toEqual([row, panel]);
  });

  it("answers a fresh empty list while inert and before a layer list exists", async () => {
    const inert = createMockRenderer({ dom: false });

    expect(inert.api.sync.hitAll(0, 0)).toEqual([]);

    const mock = createMockRenderer();

    await mock.start();

    expect(mock.api.sync.hitAll(0, 0)).toEqual([]);
    expect(mock.api.sync.hitAll(0, 0)).not.toBe(mock.api.sync.hitAll(0, 0));
  });
});

describe("sync hitBoxOf", () => {
  it("answers the local box of a sprite view: the anchor applied, no transform", async () => {
    const mock = await started();
    const cell = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 540, y: 300, rotation: Math.PI / 4, scale: 2 }),
      Sprite({ texture: "board.cell" })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitBoxOf(cell)).toEqual({ x: -32, y: -32, width: 64, height: 64 });
  });

  it("answers the box of a ui box view from its top-left corner", async () => {
    const mock = await started();
    const button = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 100, y: 200 }),
      Shape({ w: 200, h: 80 })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitBoxOf(button)).toEqual({ x: 0, y: 0, width: 200, height: 80 });
  });

  it("answers undefined for an entity without a view", async () => {
    const mock = await started();
    const bare = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform()]);

    mock.modules.sync.pass();

    expect(mock.api.sync.hitBoxOf(bare)).toBeUndefined();
    expect(mock.api.sync.hitBoxOf(42)).toBeUndefined();
  });

  it("answers a copy, so a caller cannot move the box hitTest tests", async () => {
    const mock = await started();
    const cell = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    const box = mock.api.sync.hitBoxOf(cell);

    if (box === undefined) throw new Error("the box is missing");

    box.x = 1000;

    expect(mock.api.sync.hitTest(0, 0, anyEntity)).toBe(cell);
  });
});
