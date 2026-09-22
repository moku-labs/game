import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Display, Sprite, Transform } from "../../components";
import type { Config } from "../../types";
import { FakeContainer, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

async function started(config: Partial<Config> = {}): Promise<MockRenderer> {
  const mock = createMockRenderer({ config });

  await mock.start();
  mock.api.sync.textures.provide(() => FakeTexture.WHITE as never);
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

describe("sync pools", () => {
  it("gives a released object to the next entity with the same look", async () => {
    const mock = await started();
    const first = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "board.cell" })
    ]);

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(first)?.object;

    mock.world.ecs.despawn(first);
    mock.modules.sync.pass();
    expect(mock.ctx.state.sync.pooled).toBe(1);

    const second = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "board.cell" })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(second)?.object).toBe(object);
    expect(mock.ctx.state.sync.pooled).toBe(0);
  });

  it("keeps a different texture key in a different pool", async () => {
    const mock = await started();
    const first = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();
    mock.world.ecs.despawn(first);
    mock.modules.sync.pass();

    const second = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "b" })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(second)?.object).not.toBe(
      mock.ctx.state.sync.pools.get("Sprite:a")?.[0]
    );
    expect(mock.ctx.state.sync.pools.get("Sprite:a")).toHaveLength(1);
  });

  it("resets what it pools", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 100, rotation: 1, scale: 3 }),
      Sprite({ texture: "board.cell", alpha: 0.25, tint: 0xff_00_00 })
    ]);

    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    const pooled = mock.ctx.state.sync.pools.get("Sprite:board.cell")?.[0];

    expect(pooled?.alpha).toBe(1);
    expect(pooled?.rotation).toBe(0);
    expect(pooled?.scale.x).toBe(1);
    expect(pooled?.visible).toBe(true);
    expect(pooled?.parent).toBeNull();
  });

  it("never resets an object the game owns", async () => {
    const mock = await started();
    const object = new FakeContainer();

    object.alpha = 0.4;
    object.visible = false;

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Display({ object })
    ]);

    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(object.alpha).toBe(0.4);
    expect(object.visible).toBe(false);
    expect(object.parent).toBeNull();
    expect(mock.ctx.state.sync.pooled).toBe(0);
  });

  it("destroys the oldest pooled object over the limit, and keeps its texture", async () => {
    const mock = await started({ poolLimit: 1 });
    const first = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);
    const second = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "b" })
    ]);

    mock.modules.sync.pass();

    const firstObject = mock.ctx.state.sync.views.get(first)?.object;

    mock.world.ecs.despawn(first);
    mock.modules.sync.pass();
    mock.world.ecs.despawn(second);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.pooled).toBe(1);
    expect(firstObject?.destroyed).toBe(true);
    expect(FakeTexture.WHITE.destroyed).toBe(false);
  });
});
