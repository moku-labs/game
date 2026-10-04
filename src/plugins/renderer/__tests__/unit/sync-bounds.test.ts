import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Parent, Shape, Sprite, Transform } from "../../components";
import { FakeContainer, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

/**
 * Starts a mock renderer with the layers `board` and `items`, every texture 64 x 64.
 *
 * @returns The started mock.
 */
async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.api.sync.textures.provide(() => new FakeTexture({}) as never);
  mock.world.projection.setLayers([
    { name: "board", sort: "none" },
    { name: "items", sort: "none" }
  ]);
  mock.modules.sync.pass();

  return mock;
}

/**
 * The display object of an entity's view.
 *
 * @param mock - The mock renderer.
 * @param entity - The entity.
 * @returns Its display object.
 */
function objectOf(mock: MockRenderer, entity: number) {
  const object = mock.ctx.state.sync.views.get(entity)?.object;

  if (object === undefined) throw new Error("the view is missing");

  return object;
}

describe("sync boundsOf", () => {
  it("answers the box of a sprite in reference units", async () => {
    const mock = await started();
    const coin = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 540, y: 300 }),
      Sprite({ texture: "board.coin" })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.boundsOf(coin)).toEqual({ x: 508, y: 268, width: 64, height: 64 });
  });

  it("grows the axis-aligned bounds of a child turned through its parent", async () => {
    const mock = await started();
    const slot = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 200, y: 200, rotation: Math.PI / 4 }),
      Sprite({ texture: "board.slot" })
    ]);

    mock.modules.sync.pass();

    const cell = mock.world.ecs.spawn(owner, [
      Transform(),
      Sprite({ texture: "board.cell" }),
      Parent({ entity: slot })
    ]);

    mock.modules.sync.pass();

    const bounds = mock.api.sync.boundsOf(cell);
    // A 64 x 64 box turned an eighth spans its diagonal, 64 × √2, on both axes.
    const diagonal = 64 * Math.SQRT2;

    expect(bounds?.x).toBeCloseTo(200 - diagonal / 2, 6);
    expect(bounds?.y).toBeCloseTo(200 - diagonal / 2, 6);
    expect(bounds?.width).toBeCloseTo(diagonal, 6);
    expect(bounds?.height).toBeCloseTo(diagonal, 6);
  });

  it("scales and moves the box through the parent chain and the pivots", async () => {
    const mock = await started();
    const tray = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 100, y: 100, scale: 2, pivot: { x: 10, y: 0 } }),
      Shape({ w: 20, h: 20 })
    ]);

    mock.modules.sync.pass();

    const button = mock.world.ecs.spawn(owner, [
      Transform({ x: 30, y: 5 }),
      Shape({ w: 40, h: 10 }),
      Parent({ entity: tray })
    ]);

    mock.modules.sync.pass();

    // The tray's pivot (10, 0) lands on (100, 100); the button starts 20 units right of it, doubled.
    expect(mock.api.sync.boundsOf(button)).toEqual({ x: 140, y: 110, width: 80, height: 20 });
  });

  it("answers a fresh object every call", async () => {
    const mock = await started();
    const coin = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.boundsOf(coin)).not.toBe(mock.api.sync.boundsOf(coin));
  });

  it("answers undefined for an entity without a view", async () => {
    const mock = await started();
    const bare = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform()]);

    mock.modules.sync.pass();

    expect(mock.api.sync.boundsOf(bare)).toBeUndefined();
    expect(mock.api.sync.boundsOf(42)).toBeUndefined();
  });

  it("answers undefined for a view the player cannot see", async () => {
    const mock = await started();
    const parent = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    const child = mock.world.ecs.spawn(owner, [
      Transform(),
      Sprite({ texture: "a" }),
      Parent({ entity: parent })
    ]);

    mock.modules.sync.pass();

    objectOf(mock, child).visible = false;
    expect(mock.api.sync.boundsOf(child)).toBeUndefined();

    objectOf(mock, child).visible = true;
    objectOf(mock, child).alpha = 0.01;
    expect(mock.api.sync.boundsOf(child)).toBeUndefined();

    objectOf(mock, child).alpha = 1;
    // Hiding the parent hides its child: the wrapper hangs under the parent's view.
    const wrapper = mock.ctx.state.sync.views.get(parent)?.wrapper;

    if (wrapper === undefined) throw new Error("the wrapper is missing");

    wrapper.visible = false;
    expect(mock.api.sync.boundsOf(child)).toBeUndefined();

    wrapper.visible = true;
    expect(mock.api.sync.boundsOf(child)).toBeDefined();
  });

  it("answers undefined for a box without area", async () => {
    const mock = await started();
    const line = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 0, h: 40 })
    ]);
    const collapsed = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ scale: 0 }),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    expect(mock.api.sync.boundsOf(line)).toBeUndefined();
    expect(mock.api.sync.boundsOf(collapsed)).toBeUndefined();
  });

  it("answers undefined for a view that hangs under no root of sync", async () => {
    const mock = await started();
    const coin = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();
    mock.ctx.state.sync.root = new FakeContainer() as never;

    expect(mock.api.sync.boundsOf(coin)).toBeUndefined();
  });

  it("answers undefined while inert", () => {
    const mock = createMockRenderer({ dom: false });

    expect(mock.api.sync.boundsOf(1_048_576)).toBeUndefined();
  });
});

describe("sync layerOf and layerContainer", () => {
  it("names the layer of the root of the parent chain", async () => {
    const mock = await started();
    const slot = mock.world.ecs.spawn(owner, [
      Layer({ name: "board" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();

    const cell = mock.world.ecs.spawn(owner, [
      Transform(),
      Sprite({ texture: "a" }),
      Parent({ entity: slot })
    ]);
    const loose = mock.world.ecs.spawn(owner, [Transform()]);

    mock.modules.sync.pass();

    expect(mock.modules.sync.layerOf(slot)).toBe("board");
    expect(mock.modules.sync.layerOf(cell)).toBe("board");
    expect(mock.modules.sync.layerOf(loose)).toBeUndefined();
  });

  it("answers the container of a declared layer only", async () => {
    const mock = await started();

    expect(mock.modules.sync.layerContainer("items")).toBe(
      mock.ctx.state.sync.layers.get("items")?.container
    );
    expect(mock.modules.sync.layerContainer("items")?.label).toBe("layer:items");
    expect(mock.modules.sync.layerContainer("sky")).toBeUndefined();
  });
});
