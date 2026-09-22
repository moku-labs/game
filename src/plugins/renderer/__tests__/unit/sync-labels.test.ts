import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Display, Sprite, Transform } from "../../components";
import { FakeContainer } from "../fake-pixi";
import { createMockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

describe("sync labels", () => {
  it("names the kind and the entity when there is no projection", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
    mock.modules.sync.pass();

    const entity = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.object.label).toBe(`Sprite#${entity}`);
  });

  it("adds the projection and the key of a projected view", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
    mock.modules.sync.pass();

    vi.spyOn(mock.world.projection, "keyOf").mockReturnValue({
      projection: "board.items",
      key: "i5"
    });

    const entity = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.object.label).toBe(
      `Sprite#${entity} board.items:i5`
    );
  });

  it("names the kind of a Display view too", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
    mock.modules.sync.pass();

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Display({ object: new FakeContainer() })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.object.label).toBe(`Display#${entity}`);
  });
});
