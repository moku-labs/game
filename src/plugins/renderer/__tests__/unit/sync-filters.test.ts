import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Display, NineSlice, Parent, Sprite, Transform } from "../../components";
import type { FilterSlot, PixiFilter } from "../../types";
import { FakeContainer, FakeFilter } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test: sync.filters.set, the seam effects hangs its filter instances on
// an entity's view with, and the render passes the slots cost
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

/**
 * Starts a mock renderer with one layer, "items".
 *
 * @returns The started mock.
 */
async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

/**
 * Spawns a sprite entity.
 *
 * @param mock - The mock renderer.
 * @param layer - The layer it names.
 * @returns The entity.
 */
function spawnSprite(mock: MockRenderer, layer = "items"): Entity {
  return mock.world.ecs.spawn(owner, [
    Layer({ name: layer }),
    Transform(),
    Sprite({ texture: "board.cell" })
  ]);
}

/**
 * One slot of a fake filter.
 *
 * @param filter - The fake filter.
 * @param passes - What one apply costs.
 * @returns The slot.
 */
function slot(filter: FakeFilter, passes = 1): FilterSlot {
  return { filter: filter as unknown as PixiFilter, passes };
}

/**
 * The display object of an entity, as the fake.
 *
 * @param mock - The mock renderer.
 * @param entity - The entity.
 * @returns Its object.
 */
function objectOf(mock: MockRenderer, entity: Entity): FakeContainer {
  return mock.api.sync.displayOf(entity) as FakeContainer;
}

describe("sync.filters.set", () => {
  it("lands a list set before the view exists on the view built later", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const entity = spawnSprite(mock);

    mock.api.sync.filters.set(entity, [slot(glow)]);
    mock.modules.sync.pass();

    expect(objectOf(mock, entity).filters).toEqual([glow]);
  });

  it("writes the filters at once onto a view that exists", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const tint = new FakeFilter();
    const entity = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, [slot(glow), slot(tint)]);

    expect(objectOf(mock, entity).filters).toEqual([glow, tint]);
  });

  it("hangs the filters on the wrapper of a parent, so they cover its children", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const button = spawnSprite(mock);

    mock.world.ecs.spawn(owner, [Transform(), Sprite(), Parent({ entity: button })]);
    mock.modules.sync.pass();
    mock.api.sync.filters.set(button, [slot(glow)]);

    const view = mock.ctx.state.sync.views.get(button);
    const wrapper = view?.wrapper as unknown as FakeContainer;

    expect(wrapper.filters).toEqual([glow]);
    expect((view?.object as unknown as FakeContainer).filters ?? []).toHaveLength(0);
  });

  it("moves the filters from the object into a wrapper made later", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const button = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(button, [slot(glow)]);

    const object = objectOf(mock, button);

    expect(object.filters).toEqual([glow]);

    mock.world.ecs.spawn(owner, [Transform(), Sprite(), Parent({ entity: button })]);
    mock.modules.sync.pass();

    const wrapper = mock.ctx.state.sync.views.get(button)?.wrapper as unknown as FakeContainer;

    expect(wrapper.filters).toEqual([glow]);
    expect(object.filters).toBeNull();
  });

  it("assigns nothing for the same instances, and once for a changed list", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const tint = new FakeFilter();
    const entity = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, [slot(glow)]);

    const object = objectOf(mock, entity);

    expect(object.filterWrites).toBe(1);

    // A new slot array with the same instances: a passes change effects reports, not a new list.
    mock.api.sync.filters.set(entity, [slot(glow, 2)]);
    expect(object.filterWrites).toBe(1);

    mock.api.sync.filters.set(entity, [slot(glow), slot(tint)]);
    expect(object.filterWrites).toBe(2);
    expect(object.filters).toEqual([glow, tint]);

    // Another pass of the system writes nothing.
    mock.world.ecs.set(entity, Transform, { x: 40 });
    mock.modules.sync.pass();
    expect(object.filterWrites).toBe(2);
  });

  it("writes null and forgets the entry for an empty list", async () => {
    const mock = await started();
    const entity = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, [slot(new FakeFilter())]);

    expect(objectOf(mock, entity).filters).toHaveLength(1);

    mock.api.sync.filters.set(entity, []);

    expect(objectOf(mock, entity).filters).toBeNull();
    expect(mock.ctx.state.sync.filters.has(entity)).toBe(false);
  });

  it("writes nothing on a view that never had a filter", async () => {
    const mock = await started();
    const entity = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, []);

    expect(objectOf(mock, entity).filterWrites).toBe(0);
  });

  it("takes the filters off an object that goes back to the pool, and forgets the entity", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const entity = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, [slot(glow)]);

    const object = objectOf(mock, entity);

    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect([...mock.ctx.state.sync.pools.values()].flat()).toContain(object);
    expect(object.filters).toBeNull();
    expect(mock.ctx.state.sync.filters.has(entity)).toBe(false);
    expect(glow.destroyed).toBe(false);
  });

  it("keeps the filters of an entity that swaps its visual within one frame", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const entity = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, [slot(glow)]);
    mock.world.ecs.remove(entity, Sprite);
    mock.world.ecs.add(entity, NineSlice({ texture: "ui.panel", width: 200, height: 80 }));
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.kind).toBe("NineSlice");
    expect(objectOf(mock, entity).filters).toEqual([glow]);
  });

  it("keeps the filters of a live entity whose visual left, and hangs them on its next view", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const entity = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, [slot(glow)]);
    mock.world.ecs.remove(entity, Sprite);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.has(entity)).toBe(false);
    expect(mock.ctx.state.sync.filters.get(entity)).toEqual([slot(glow)]);

    mock.modules.sync.pass();
    mock.world.ecs.add(entity, Sprite({ texture: "board.cell" }));
    mock.modules.sync.pass();

    expect(objectOf(mock, entity).filters).toEqual([glow]);
  });

  it("forgets the filters of an entity that despawned without a view", async () => {
    const mock = await started();
    const entity = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, [slot(new FakeFilter())]);
    mock.world.ecs.remove(entity, Sprite);
    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.filters.has(entity)).toBe(false);
  });

  it("lets a Display object go without the filters it hung on it, on despawn and at stop", async () => {
    const mock = await started();
    const left = new FakeContainer();
    const kept = new FakeContainer();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Display({ object: left })
    ]);
    const other = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Display({ object: kept })
    ]);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, [slot(new FakeFilter())]);
    mock.api.sync.filters.set(other, [slot(new FakeFilter())]);
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(left.filters).toBeNull();
    expect(kept.filters).toHaveLength(1);

    mock.stop();

    expect(kept.filters).toBeNull();
    expect(kept.destroyed).toBe(false);
  });

  it("forgets every entry when the renderer stops, and destroys no filter", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const entity = spawnSprite(mock);

    mock.api.sync.filters.set(entity, [slot(glow)]);
    mock.modules.sync.pass();
    mock.stop();

    expect(mock.ctx.state.sync.filters.size).toBe(0);
    expect(glow.destroyed).toBe(false);
  });

  it("applies the filters again when the tree is rebuilt", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const entity = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, [slot(glow)]);

    const before = objectOf(mock, entity);

    mock.modules.sync.rebuildAll();

    const after = objectOf(mock, entity);

    expect(after).not.toBe(before);
    expect(after.filters).toEqual([glow]);
  });

  it("stores the list while inert and applies nothing", async () => {
    const mock = createMockRenderer({ dom: false });

    await mock.start();
    mock.api.sync.filters.set(7, [slot(new FakeFilter())]);

    expect(mock.ctx.state.sync.filters.get(7)).toHaveLength(1);
    expect(mock.api.sync.displayOf(7)).toBeUndefined();
  });
});

/**
 * Reads the passes both ways, so every pin checks that `sync.renderPasses()` is the number
 * `stats()` reports.
 *
 * @param mock - The mock renderer.
 * @returns The passes `sync.renderPasses()` reads, when `stats()` reads the same.
 */
function passesOf(mock: MockRenderer): number {
  const passes = mock.api.sync.renderPasses();

  expect(mock.api.stats().renderPasses).toBe(passes);

  return passes;
}

describe("renderPasses", () => {
  it("reads 0 while inert and 1 for a frame without filters", async () => {
    const inert = createMockRenderer({ dom: false });

    inert.api.sync.filters.set(7, [slot(new FakeFilter())]);

    expect(passesOf(inert)).toBe(0);

    const mock = await started();

    spawnSprite(mock);
    mock.modules.sync.pass();

    expect(passesOf(mock)).toBe(1);
  });

  it("adds the content pass and the passes of the slots: 3 for one glow, 10 for one blur", async () => {
    const mock = await started();
    const button = spawnSprite(mock);
    const backdrop = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(button, [slot(new FakeFilter(), 1)]);

    expect(passesOf(mock)).toBe(3);

    mock.api.sync.filters.set(button, []);
    mock.api.sync.filters.set(backdrop, [slot(new FakeFilter(), 8)]);

    expect(passesOf(mock)).toBe(10);
  });

  it("reads 31 for a glow and a tint on ten buttons", async () => {
    const mock = await started();
    const buttons = Array.from({ length: 10 }, () => spawnSprite(mock));

    mock.modules.sync.pass();

    for (const button of buttons) {
      mock.api.sync.filters.set(button, [slot(new FakeFilter()), slot(new FakeFilter())]);
    }

    expect(passesOf(mock)).toBe(31);
  });

  it("counts no view that is out of the tree", async () => {
    const mock = await started();
    const lost = spawnSprite(mock, "nowhere");

    mock.modules.sync.pass();
    mock.api.sync.filters.set(lost, [slot(new FakeFilter())]);

    expect(mock.ctx.state.sync.views.has(lost)).toBe(true);
    expect(passesOf(mock)).toBe(1);
  });

  it("counts a filtered child that hangs in its parent's wrapper", async () => {
    const mock = await started();
    const button = spawnSprite(mock);
    const label = mock.world.ecs.spawn(owner, [Transform(), Sprite(), Parent({ entity: button })]);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(label, [slot(new FakeFilter())]);

    expect(passesOf(mock)).toBe(3);
  });

  it("counts 0 for a disabled slot, and 0 for a view whose slots are all disabled", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const tint = new FakeFilter();
    const button = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(button, [slot(glow), slot(tint)]);

    expect(passesOf(mock)).toBe(4);

    tint.enabled = false;
    expect(passesOf(mock)).toBe(3);

    glow.enabled = false;
    expect(passesOf(mock)).toBe(1);
  });

  it("reads the slots alone: no texture walk, no counts object", async () => {
    const mock = await started();
    const button = spawnSprite(mock);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(button, [slot(new FakeFilter())]);

    const textures = vi.spyOn(mock.modules.host, "textures");
    const counts = vi.spyOn(mock.modules.sync, "counts");

    expect(mock.api.sync.renderPasses()).toBe(3);
    expect(textures).not.toHaveBeenCalled();
    expect(counts).not.toHaveBeenCalled();
  });
});
