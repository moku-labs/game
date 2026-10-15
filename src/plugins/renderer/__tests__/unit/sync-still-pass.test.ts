import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Sprite, Transform } from "../../components";
import type { FilterSlot, PixiFilter } from "../../types";
import { FakeFilter } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test: the sync pass of a still frame. It runs every frame, so a frame
// in which nothing was added, removed or despawned builds no change set and
// walks no filter entry; the entries of an entity that despawned without a
// view still go.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
 * Spawns a sprite in the "items" layer and builds its view.
 *
 * @param mock - The mock renderer.
 * @returns The entity.
 */
function drawnSprite(mock: MockRenderer): Entity {
  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform(),
    Sprite({ texture: "board.cell" })
  ]);

  mock.modules.sync.pass();
  mock.world.clearChanges();

  return entity;
}

/**
 * One slot of a fake filter.
 *
 * @returns The slot.
 */
function glowSlot(): FilterSlot {
  return { filter: new FakeFilter() as unknown as PixiFilter, passes: 1 };
}

/**
 * Counts the sets constructed while `run` runs, through a counting subclass on the global.
 *
 * @param run - The work to watch.
 * @returns How many sets it constructed.
 */
function setsMadeBy(run: () => void): number {
  const NativeSet = globalThis.Set;
  let made = 0;

  /** A set that counts its constructions. */
  class CountingSet<Value> extends NativeSet<Value> {
    /**
     * Counts one construction.
     *
     * @param values - The first values.
     */
    constructor(values?: Iterable<Value> | null) {
      super(values);
      made += 1;
    }
  }

  vi.stubGlobal("Set", CountingSet);

  try {
    run();
  } finally {
    vi.unstubAllGlobals();
  }

  return made;
}

describe("the sync pass of a still frame", () => {
  // Bug: the pass copied the empty change set and made two more sets to build nothing, every frame.
  it("constructs no set when nothing waits to be built", async () => {
    const mock = await started();

    drawnSprite(mock);

    expect(setsMadeBy(() => mock.modules.sync.pass())).toBe(0);
  });

  // Bug: the pass walked every filter and area entry for despawned entities, every frame, with an iterator each.
  it("walks no filter entry while every filtered entity has its view", async () => {
    const mock = await started();
    const entity = drawnSprite(mock);

    mock.api.sync.filters.set(entity, [glowSlot()]);
    mock.api.sync.filters.area(entity, [0, 0, 64, 64]);
    mock.modules.sync.pass();

    const filterKeys = vi.spyOn(mock.ctx.state.sync.filters, "keys");
    const areaKeys = vi.spyOn(mock.ctx.state.sync.areas, "keys");

    mock.modules.sync.pass();
    mock.modules.sync.pass();

    expect(filterKeys).not.toHaveBeenCalled();
    expect(areaKeys).not.toHaveBeenCalled();
  });

  it("forgets the filters of an entity that despawned having never had a view", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [Transform()]);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, [glowSlot()]);
    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.filters.has(entity)).toBe(false);
  });

  it("forgets the area of an entity that despawned having never had a view", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [Transform()]);

    mock.modules.sync.pass();
    mock.api.sync.filters.area(entity, [0, 0, 64, 64]);
    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.areas.has(entity)).toBe(false);
  });

  it("forgets the filters of an entity a rebuild left without a view, once it despawns", async () => {
    const mock = await started();
    // No Layer: the pass builds its view, a rebuild builds the views of the layered entities only.
    const entity = mock.world.ecs.spawn(owner, [Transform(), Sprite({ texture: "board.cell" })]);

    mock.modules.sync.pass();
    expect(mock.ctx.state.sync.views.has(entity)).toBe(true);

    mock.api.sync.filters.set(entity, [glowSlot()]);
    mock.modules.sync.rebuildAll();
    expect(mock.ctx.state.sync.views.has(entity)).toBe(false);

    mock.world.ecs.remove(entity, Sprite);
    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.filters.has(entity)).toBe(false);
  });
});
