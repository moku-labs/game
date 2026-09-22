import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer, Order } from "../../../world/ecs/define";
import { Parent, Sprite, Transform } from "../../components";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

async function started(
  layers: Array<{ name: string; sort: "none" | "y" | "order" }> = [{ name: "items", sort: "none" }]
): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers(layers);
  mock.modules.sync.pass();

  return mock;
}

describe("sync layers", () => {
  it("mirrors the projection list as containers under the root, in draw order", async () => {
    const mock = await started([
      { name: "board", sort: "none" },
      { name: "items", sort: "y" },
      { name: "lift", sort: "none" }
    ]);

    expect(mock.ctx.state.sync.root?.children.map(child => child.label)).toEqual([
      "layer:board",
      "layer:items",
      "layer:lift"
    ]);
    expect(mock.ctx.state.sync.layers.get("items")?.container?.sortableChildren).toBe(true);
    expect(mock.ctx.state.sync.layers.get("board")?.container?.sortableChildren).toBe(false);
  });

  it("rebuilds only when the list is a new reference", async () => {
    const mock = await started();
    const container = mock.ctx.state.sync.layers.get("items")?.container;

    mock.modules.sync.pass();
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.layers.get("items")?.container).toBe(container);
  });

  it("keeps the container of a name that stays", async () => {
    const mock = await started([{ name: "items", sort: "none" }]);
    const container = mock.ctx.state.sync.layers.get("items")?.container;

    mock.world.projection.setLayers([
      { name: "items", sort: "none" },
      { name: "lift", sort: "none" }
    ]);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.layers.get("items")?.container).toBe(container);
    expect(mock.ctx.state.sync.root?.children).toHaveLength(2);
  });

  it("detaches the views of a layer that left and names them", async () => {
    const mock = await started([{ name: "items", sort: "none" }]);

    mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);
    mock.modules.sync.pass();

    mock.world.projection.setLayers([{ name: "board", sort: "none" }]);
    mock.modules.sync.pass();

    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: views left without a layer",
      expect.objectContaining({ entities: expect.any(Array) })
    );
  });

  it("writes zIndex from y on a y layer, and only when it changed", async () => {
    const mock = await started([{ name: "items", sort: "y" }]);
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ y: 120 }),
      Sprite()
    ]);

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(entity)?.object;

    expect(object?.zIndex).toBe(120);

    mock.world.ecs.set(entity, Transform, { y: 300 });
    mock.modules.sync.pass();
    expect(object?.zIndex).toBe(300);
  });

  it("writes zIndex from Order on an order layer, and 0 without Order", async () => {
    const mock = await started([{ name: "items", sort: "order" }]);
    const first = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite(),
      Order({ value: 7 })
    ]);
    const second = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(first)?.object.zIndex).toBe(7);
    expect(mock.ctx.state.sync.views.get(second)?.object.zIndex).toBe(0);
  });

  it("never writes zIndex on a layer that does not sort", async () => {
    const mock = await started([{ name: "items", sort: "none" }]);
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ y: 999 }),
      Sprite()
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.object.zIndex).toBe(0);
  });

  it("moves the same display object when a lift changes the layer", async () => {
    const mock = await started([
      { name: "items", sort: "none" },
      { name: "lift", sort: "none" }
    ]);
    const entity = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(entity)?.object;

    mock.world.ecs.set(entity, Layer, { name: "lift" });
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.object).toBe(object);
    expect(object?.parent).toBe(mock.ctx.state.sync.layers.get("lift")?.container);
  });

  it("does not draw an entity whose layer the scene does not declare", async () => {
    const mock = await started([{ name: "items", sort: "none" }]);

    mock.world.ecs.spawn(owner, [Layer({ name: "ghosts" }), Transform(), Sprite()]);
    mock.modules.sync.pass();

    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: entity is not drawn, unknown layer",
      expect.objectContaining({ layer: "ghosts" })
    );
    expect(mock.ctx.state.sync.layers.get("items")?.container?.children).toHaveLength(0);
  });

  it("gives a parent a wrapper and draws its child inside it", async () => {
    const mock = await started();
    const parent = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 100 }),
      Sprite()
    ]);

    mock.modules.sync.pass();

    const child = mock.world.ecs.spawn(owner, [
      Transform({ x: 10 }),
      Sprite(),
      Parent({ entity: parent })
    ]);

    mock.modules.sync.pass();

    const wrapper = mock.ctx.state.sync.views.get(parent)?.wrapper;
    const childObject = mock.ctx.state.sync.views.get(child)?.object;

    expect(wrapper).toBeDefined();
    expect(wrapper?.position.x).toBe(100);
    expect(wrapper?.parent).toBe(mock.ctx.state.sync.layers.get("items")?.container);
    expect(childObject?.parent).toBe(wrapper);
    expect(mock.ctx.state.sync.views.get(child)?.layer).toBe("");
  });
});
