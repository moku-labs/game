import { describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Sprite, Transform } from "../../components";
import { applyArea } from "../../sync/filters";
import { FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: the stretch of a sprite is compared by its numbers (R2 of change 2026-10-18-cheap-idle-tick). A write that
// keeps the stretch (an alpha tween, a tint) writes no filter area and no transform again; a new size does both.
// ---------------------------------------------------------------------------

vi.mock("../../sync/filters", async importOriginal => {
  const actual = await importOriginal<typeof import("../../sync/filters")>();

  return { ...actual, applyArea: vi.fn(actual.applyArea) };
});

/**
 * Starts the renderer with one 64 x 64 sprite of a 64 x 64 texture that carries a filter area, every change taken.
 *
 * @returns The started renderer and the entity.
 */
async function spriteWithArea(): Promise<{ mock: MockRenderer; entity: number }> {
  const mock = createMockRenderer();
  const texture = new FakeTexture({ source: { width: 64, height: 64, destroyed: false } });

  await mock.start();
  mock.api.sync.textures.provide(() => texture as never);
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  const entity = mock.world.ecs.spawn({ kind: "plugin", name: "test" }, [
    Layer({ name: "items" }),
    Transform({ x: 100, y: 100 }),
    Sprite({ texture: "card", width: 64, height: 64 })
  ]);

  mock.modules.sync.pass();
  mock.api.sync.filters.area(entity, [0, 0, 64, 64]);
  mock.modules.sync.pass();
  mock.world.clearChanges();
  vi.mocked(applyArea).mockClear();

  return { mock, entity };
}

describe("a sprite's stretch", () => {
  it("is not laid out again for an alpha write: its filter area is left alone", async () => {
    const { mock, entity } = await spriteWithArea();

    mock.world.ecs.set(entity, Sprite, { alpha: 0.5 });
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.object.alpha).toBe(0.5);
    expect(applyArea).not.toHaveBeenCalled();
  });

  it("writes the filter area and the scale again when a new size changes it", async () => {
    const { mock, entity } = await spriteWithArea();

    mock.world.ecs.set(entity, Sprite, { width: 128 });
    mock.modules.sync.pass();

    expect(applyArea).toHaveBeenCalledTimes(1);
    expect(mock.ctx.state.sync.views.get(entity)?.object.scale.x).toBe(2);
    expect(mock.api.sync.hitBoxOf(entity)).toEqual({ x: -64, y: -32, width: 128, height: 64 });
  });
});
