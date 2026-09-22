import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Sprite, Transform } from "../../components";
import { FakeTexture } from "../fake-pixi";
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

function spawnSprite(mock: MockRenderer, texture: string): number {
  return mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite({ texture })]);
}

describe("sync textures", () => {
  it("asks the newest provider first and takes the first answer", async () => {
    const mock = await started();
    const older = new FakeTexture({});
    const newer = new FakeTexture({});

    mock.api.sync.textures.provide(() => older as never);
    mock.api.sync.textures.provide(() => newer as never);

    const entity = spawnSprite(mock, "board.cell");

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(entity)?.object;

    expect(object).toHaveProperty("texture", newer);
  });

  it("stops asking a provider that was removed", async () => {
    const mock = await started();
    const texture = new FakeTexture({});
    const off = mock.api.sync.textures.provide(() => texture as never);

    off();
    off();

    const entity = spawnSprite(mock, "board.cell");

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.placeholder).toBe(true);
  });

  it("draws the magenta placeholder and warns once per key", async () => {
    const mock = await started();

    spawnSprite(mock, "board.cell");
    spawnSprite(mock, "board.cell");
    mock.modules.sync.pass();

    const container = mock.ctx.state.sync.layers.get("items")?.container;

    expect(container?.children).toHaveLength(2);
    expect(container?.children[0]).toHaveProperty("tint", 0xff_00_ff);
    expect(container?.children[0]?.scale.x).toBe(64);
    expect(
      vi
        .mocked(mock.log.warn)
        .mock.calls.filter(call => call[0] === "renderer: no texture for asset key")
    ).toHaveLength(1);
  });

  it("does not ask again for a missing key until it is invalidated", async () => {
    const mock = await started();
    let asks = 0;

    mock.api.sync.textures.provide(() => {
      asks += 1;

      return undefined;
    });
    spawnSprite(mock, "board.cell");
    mock.modules.sync.pass();
    mock.world.clearChanges();

    const afterCreate = asks;

    mock.modules.sync.pass();
    mock.modules.sync.pass();

    expect(asks).toBe(afterCreate);
  });

  it("heals a placeholder when the bundle arrives and is invalidated", async () => {
    const mock = await started();
    const loaded = new Map<string, FakeTexture>();

    mock.api.sync.textures.provide(key => loaded.get(key) as never);

    const entity = spawnSprite(mock, "board.cell");

    mock.modules.sync.pass();
    expect(mock.ctx.state.sync.views.get(entity)?.placeholder).toBe(true);

    loaded.set("board.cell", new FakeTexture({}));
    mock.api.sync.textures.invalidate(["board.cell"]);
    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(entity);

    expect(view?.placeholder).toBe(false);
    expect(view?.object).toHaveProperty("texture", loaded.get("board.cell"));
    expect(view?.object.scale.x).toBe(1);
  });

  it("destroys the pooled objects of an invalidated key", async () => {
    const mock = await started();
    const entity = spawnSprite(mock, "board.cell");

    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    const pooled = mock.ctx.state.sync.pools.get("Sprite:board.cell")?.[0];

    mock.api.sync.textures.invalidate(["board.cell"]);

    expect(pooled?.destroyed).toBe(true);
    expect(mock.ctx.state.sync.pools.has("Sprite:board.cell")).toBe(false);
    expect(mock.ctx.state.sync.pooled).toBe(0);
  });

  it("invalidates a key nothing uses without touching anything", async () => {
    const mock = await started();

    mock.api.sync.textures.invalidate(["nobody.uses.this"]);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.invalidated.size).toBe(0);
    expect(mock.ctx.state.sync.pools.size).toBe(0);
  });

  it("removes a provider that is no longer in the chain", async () => {
    const mock = await started();
    const off = mock.api.sync.textures.provide(() => undefined);

    mock.ctx.state.sync.providers.length = 0;
    off();

    expect(mock.ctx.state.sync.providers).toHaveLength(0);
  });

  it("makes a texture and writes the nine-slice borders", async () => {
    const mock = await started();
    const plain = mock.api.sync.textures.create({ width: 32, height: 32 } as never);
    const nine = mock.api.sync.textures.create({ width: 64, height: 64 } as never, {
      nine: [12, 10, 8, 6]
    });

    expect(plain).toHaveProperty("source");
    expect(nine).toHaveProperty("defaultBorders", { left: 12, top: 10, right: 8, bottom: 6 });
  });

  it("frees the wrapper texture of a nine-slice and keeps its source", async () => {
    const mock = await started();
    const before = FakeTexture.made.length;
    const nine = mock.api.sync.textures.create({ width: 64, height: 64 } as never, {
      nine: [1, 2, 3, 4]
    });
    const wrapper = FakeTexture.made[before];

    expect(wrapper?.destroyed).toBe(true);
    expect(wrapper?.source.destroyed).toBe(false);
    expect(nine).toHaveProperty("destroyed", false);
    expect(nine.source).toBe(wrapper?.source);
  });

  it("refuses to make a texture while the device is lost", async () => {
    const mock = await started();

    mock.ctx.state.host.ready = false;

    expect(() => mock.api.sync.textures.create({ width: 8, height: 8 } as never)).toThrow(
      "[game] renderer.sync.textures.create needs a ready renderer."
    );
  });

  it("frees a texture once, however often it is asked", async () => {
    const mock = await started();
    const texture = new FakeTexture({});

    mock.api.sync.textures.destroy(texture as never);
    mock.api.sync.textures.destroy(texture as never);

    expect(texture.destroyCalls).toBe(1);
    expect(texture.source.destroyed).toBe(true);
  });
});
