import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Display, NineSlice, Parent, Sprite, Transform } from "../../components";
import { FakeContainer, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

describe("sync views", () => {
  it("builds a display object for a spawned sprite and labels it", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 540, y: 300 }),
      Sprite({ texture: "board.cell" })
    ]);

    expect(mock.ctx.state.sync.added.has(entity)).toBe(true);

    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(entity);

    expect(view?.kind).toBe("Sprite");
    expect(view?.poolKey).toBe("Sprite:board.cell");
    expect(view?.object.label).toBe(`Sprite#${entity}`);
    expect(view?.object.position.x).toBe(540);
    expect(view?.object.position.y).toBe(300);
    expect(mock.api.sync.displayOf(entity)).toBe(view?.object);
  });

  it("takes a view out of the tree when its component leaves", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);

    expect(mock.ctx.state.sync.removed.has(entity)).toBe(true);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.has(entity)).toBe(false);
    expect(mock.api.sync.displayOf(entity)).toBeUndefined();
    expect(mock.ctx.state.sync.layers.get("items")?.container?.children).toHaveLength(0);
  });

  it("touches only the entities the frame changed", async () => {
    const mock = await started();
    const moved = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);
    const still = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 5 }),
      Sprite()
    ]);

    mock.modules.sync.pass();
    mock.world.clearChanges();

    const stillObject = mock.ctx.state.sync.views.get(still)?.object;

    if (stillObject !== undefined) stillObject.position.set(-1, -1);

    mock.world.ecs.set(moved, Transform, { x: 42 });
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(moved)?.object.position.x).toBe(42);
    expect(stillObject?.position.x).toBe(-1);
  });

  it("attaches and detaches the object a Display component carries", async () => {
    const mock = await started();
    const object = new FakeContainer();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Display({ object })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.kind).toBe("Display");
    expect(object.parent).toBe(mock.ctx.state.sync.layers.get("items")?.container);
    expect(mock.ctx.state.sync.views.get(entity)?.hitBox).toEqual({
      x: -50,
      y: -50,
      width: 100,
      height: 100
    });

    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(object.destroyed).toBe(false);
    expect(object.parent).toBeNull();
  });

  it("reports an entity that carries two visuals and keeps the first", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" }),
      NineSlice({ texture: "b", width: 10, height: 10 })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.kind).toBe("Sprite");
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: entity has more than one visual",
      expect.objectContaining({ kinds: ["Sprite", "NineSlice"] })
    );
  });

  it("writes the nine-slice size in reference units", async () => {
    const mock = await started();

    mock.api.sync.textures.provide(() => FakeTexture.WHITE as never);

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      NineSlice({ texture: "ui.panel", width: 600, height: 320 })
    ]);

    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(entity);

    expect(view?.kind).toBe("NineSlice");
    expect(view?.hitBox).toEqual({ x: 0, y: 0, width: 600, height: 320 });
  });

  it("builds every existing entity again on rebuildAll", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    mock.modules.sync.pass();

    const before = mock.ctx.state.sync.views.get(entity)?.object;

    mock.modules.sync.rebuildAll();

    const after = mock.ctx.state.sync.views.get(entity)?.object;

    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect(mock.ctx.state.sync.root?.children.map(child => child.label)).toEqual(["layer:items"]);
  });

  it("detaches the children of a parent that left, and names them", async () => {
    const mock = await started();
    const parent = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    mock.modules.sync.pass();

    const child = mock.world.ecs.spawn(owner, [Transform(), Sprite(), Parent({ entity: parent })]);

    mock.modules.sync.pass();

    const childObject = mock.ctx.state.sync.views.get(child)?.object;

    mock.world.ecs.despawn(parent);
    mock.modules.sync.pass();

    expect(childObject?.parent).toBeNull();
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: parent left before its children",
      expect.objectContaining({ parent })
    );
  });

  it("does not draw a child whose parent draws nothing", async () => {
    const mock = await started();
    const child = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite(),
      Parent({ entity: 999_999 })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(child)?.object.parent).toBeNull();
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: parent draws nothing",
      expect.objectContaining({ entity: child })
    );
  });

  it("draws nothing for a Display that holds no display object", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Display({ object: 42 })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.has(entity)).toBe(false);
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: Display holds no display object",
      expect.objectContaining({ entity })
    );
  });
});
