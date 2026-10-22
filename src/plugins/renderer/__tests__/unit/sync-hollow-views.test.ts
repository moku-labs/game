import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { NineSlice, Parent, Sprite, Transform } from "../../components";
import {
  type FakeContainer,
  FakeMesh,
  type FakeMeshGeometry,
  FakeNineSliceSprite,
  FakeTexture
} from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test of the hollow `NineSlice` view (F59) on the fake Pixi: `hollow: true` is drawn by the engine's rim-only
// mesh, written through the same numbers as a filled panel; a flip swaps the object on that write; the two kinds
// never share a pool; an unloaded bundle frees its pooled hollow panels; the hit box, the outline and the clip are a
// filled panel's.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

/** A rim-only panel of the fake: Pixi's mesh with the numbers of a nine-slice. */
type HollowMesh = FakeMesh & {
  hollow: true;
  leftWidth: number;
  topHeight: number;
  rightWidth: number;
  bottomHeight: number;
  width: number;
  height: number;
};

/** The frost frame of the memory screen: a 300 × 300 texture cut 48 across and 40 down. */
const frost = new FakeTexture({
  source: { width: 300, height: 300, destroyed: false },
  defaultBorders: { left: 48, top: 40, right: 48, bottom: 40 }
});

/**
 * Starts the mock renderer with the `items` layer and the frost texture behind every key.
 *
 * @returns The mock.
 */
async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.api.sync.textures.provide(() => frost as never);
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

/**
 * Spawns a frost panel in the `items` layer and builds its view.
 *
 * @param mock - The mock renderer.
 * @param value - The `NineSlice` fields besides the texture.
 * @returns The entity.
 */
function panel(mock: MockRenderer, value: Parameters<typeof NineSlice>[0] = {}): Entity {
  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform({ x: 100, y: 50 }),
    NineSlice({ texture: "glass.frost", width: 960, height: 1400, ...value })
  ]);

  mock.modules.sync.pass();

  return entity;
}

/**
 * The object of an entity's view.
 *
 * @param mock - The mock renderer.
 * @param entity - The entity.
 * @returns The object.
 */
function objectOf(mock: MockRenderer, entity: Entity): FakeContainer {
  return mock.api.sync.displayOf(entity) as FakeContainer;
}

describe("sync views: a hollow nine-slice", () => {
  // Bug: `hollow: true` builds Pixi's filled sprite, or the rim-only object never gets the texture's borders and size.
  it("is drawn by the rim-only mesh, with the texture, the borders and the size a filled panel gets", async () => {
    const mock = await started();
    const entity = panel(mock, { hollow: true, tint: 0xd0_e8_ff });
    const object = objectOf(mock, entity) as HollowMesh;

    expect(object).toBeInstanceOf(FakeMesh);
    expect(object.hollow).toBe(true);
    expect(object.texture).toBe(frost);
    expect(object.tint).toBe(0xd0_e8_ff);
    expect([object.leftWidth, object.topHeight, object.rightWidth, object.bottomHeight]).toEqual([
      48, 40, 48, 40
    ]);
    expect([object.width, object.height]).toEqual([960, 1400]);
    expect(object.geometry.indices).toHaveLength(48);
    // The top row of the grid: the cut lines across, at the borders.
    expect(object.geometry.positions.slice(0, 8)).toEqual(
      Float32Array.of(0, 0, 48, 0, 912, 0, 960, 0)
    );
  });

  // Bug: the hit box follows the drawn rim, so a tap in the empty middle of a frame falls through it.
  it("keeps the whole panel as its hit box: a tap in its empty centre lands on it", async () => {
    const mock = await started();
    const entity = panel(mock, { hollow: true });

    expect(mock.api.sync.hitBoxOf(entity)).toEqual({ x: 0, y: 0, width: 960, height: 1400 });
    expect(mock.api.sync.hitTest(100 + 480, 50 + 700, () => true)).toBe(entity);
  });

  // Bug: a flip of `hollow` is ignored, or rebuilds the view and drops its children as orphans, or puts the panel
  // inside its own clip, or leaks the object it no longer draws with.
  it("swaps its object on the write that flips hollow, keeping its place, its children and its clip", async () => {
    const mock = await started();
    const entity = panel(mock, { width: 600, height: 320, clip: true });
    const child = mock.world.ecs.spawn(owner, [
      Parent({ entity }),
      Transform({ x: 10, y: 10 }),
      Sprite({ texture: "glass.frost" })
    ]);

    mock.modules.sync.pass();
    mock.world.clearChanges();

    const filled = objectOf(mock, entity);

    mock.world.ecs.set(entity, NineSlice, { hollow: true });
    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(entity);
    const hollow = objectOf(mock, entity) as HollowMesh;

    expect(filled).toBeInstanceOf(FakeNineSliceSprite);
    expect(hollow).toBeInstanceOf(FakeMesh);
    expect([hollow.width, hollow.height, hollow.leftWidth]).toEqual([600, 320, 48]);
    // In the wrapper, outside the clip; the child still in the clip, never orphaned.
    expect(hollow.parent).toBe(view?.wrapper);
    expect(objectOf(mock, child).parent).toBe(view?.clipped);
    expect(view?.wrapper?.position).toMatchObject({ x: 100, y: 50 });
    expect(mock.ctx.state.sync.entityOf.get(hollow)).toBe(entity);
    expect(mock.ctx.state.sync.entityOf.has(filled)).toBe(false);
    expect(mock.ctx.state.sync.orphans.has(child)).toBe(false);
    expect(mock.log.warn).not.toHaveBeenCalledWith(
      "renderer: parent left before its children",
      expect.anything()
    );
    expect(mock.api.sync.hitBoxOf(entity)).toEqual({ x: 0, y: 0, width: 600, height: 320 });
    // The filled object went back to its pool, out of the tree.
    expect(filled.parent).toBeNull();
    expect(mock.ctx.state.sync.pools.get("NineSlice:glass.frost")).toEqual([filled]);

    mock.world.ecs.set(entity, NineSlice, { hollow: false });
    mock.modules.sync.pass();

    expect(objectOf(mock, entity)).toBe(filled);
    expect(mock.ctx.state.sync.pools.get("NineSlice.hollow:glass.frost")).toEqual([hollow]);
  });

  // Bug: one pool for both kinds: a filled panel takes the pooled rim-only mesh (and swaps it at once), or a hollow
  // panel builds a new mesh while one waits.
  it("goes back to a pool of its own: a filled panel never takes it, the next hollow one does", async () => {
    const mock = await started();
    const first = panel(mock, { hollow: true });
    const mesh = objectOf(mock, first);

    mock.world.ecs.despawn(first);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.pools.get("NineSlice.hollow:glass.frost")).toEqual([mesh]);
    expect(objectOf(mock, panel(mock))).toBeInstanceOf(FakeNineSliceSprite);
    expect(mock.ctx.state.sync.pools.get("NineSlice.hollow:glass.frost")).toEqual([mesh]);
    expect(objectOf(mock, panel(mock, { hollow: true }))).toBe(mesh);
  });

  // Bug: the unload of a bundle destroys the pooled filled panels and keeps the hollow ones, with their geometry.
  it("is destroyed with its geometry when the bundle of its pool unloads", async () => {
    const mock = await started();
    const entity = panel(mock, { hollow: true });
    const mesh = objectOf(mock, entity) as HollowMesh;

    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();
    mock.api.sync.textures.invalidate(["glass.frost"]);

    expect(mesh.destroyed).toBe(true);
    expect((mesh.geometry as FakeMeshGeometry).destroyed).toBe(true);
    expect(mock.ctx.state.sync.pooled).toBe(0);
    expect(mock.ctx.state.sync.pools.has("NineSlice.hollow:glass.frost")).toBe(false);
  });

  // Bug: the debug outline or the clip of a filled panel is lost on a hollow one.
  it("draws the debug outline and clips its children as a filled panel does", async () => {
    const mock = await started();
    const entity = panel(mock, { hollow: true, debug: true, clip: true, width: 600, height: 320 });
    const child = mock.world.ecs.spawn(owner, [Parent({ entity }), Transform(), Sprite()]);

    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(entity);

    expect(view?.outline?.parent).toBe(view?.wrapper);
    expect(view?.clipDrawn).toEqual({ kind: "rect", w: 600, h: 320, radius: 0 });
    expect(view?.clipped?.mask).toBe(view?.mask);
    expect(objectOf(mock, child).parent).toBe(view?.clipped);
  });
});
