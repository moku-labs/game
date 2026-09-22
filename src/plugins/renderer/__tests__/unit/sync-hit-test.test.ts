import { afterEach, describe, expect, it, vi } from "vitest";
import { Exiting, Layer, Order } from "../../../world/ecs/define";
import { Parent, Sprite, Transform } from "../../components";
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
});
