import { describe, expect, it } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Sprite, Transform } from "../../components";
import { withDeps } from "../../lifecycle";
import type { HiddenCtx } from "../../sync/hidden";
import { liftFor, setLayerHidden, swapHidden } from "../../sync/hidden";
import type { PixiContainer, PixiFilter } from "../../types";
import { FakeFilter } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: the render passes counted once and read every frame (Q2 of change 2026-10-18-cheap-idle-tick). The count of
// the filtered views is kept until something it reads changes; each change below must reach the next read.
// ---------------------------------------------------------------------------

const owner = { kind: "plugin", name: "test" } as const;

/** A started renderer with one sprite carrying one filter of one apply: 3 passes, read once so the count is kept. */
async function filteredSprite(): Promise<{
  mock: MockRenderer;
  entity: number;
  hidden: HiddenCtx;
}> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform(),
    Sprite({ texture: "board.cell" })
  ]);

  mock.modules.sync.pass();
  mock.api.sync.filters.set(entity, [
    { filter: new FakeFilter() as unknown as PixiFilter, passes: 1 }
  ]);
  mock.world.clearChanges();
  expect(mock.api.sync.renderPasses()).toBe(3);

  return {
    mock,
    entity,
    hidden: { ctx: withDeps(mock.ctx), deps: { demand: mock.modules.demand } }
  };
}

describe("the kept count of the render passes", () => {
  it("drops a view the pass took away, its filters kept for the entity", async () => {
    const { mock, entity } = await filteredSprite();

    mock.world.ecs.remove(entity, Sprite);
    mock.modules.sync.pass();

    expect(mock.api.sync.renderPasses()).toBe(1);
  });

  it("drops the views of a layer an overlay hides, and counts them again when it shows", async () => {
    const { mock, hidden } = await filteredSprite();

    setLayerHidden(hidden, "items", "cover", true);
    expect(mock.api.sync.renderPasses()).toBe(1);

    setLayerHidden(hidden, "items", "cover", false);
    expect(mock.api.sync.renderPasses()).toBe(3);
  });

  it("follows a game's own object hidden after an invalidate, as the contract of invalidate asks", async () => {
    const { mock, entity } = await filteredSprite();
    const object = mock.api.sync.displayOf(entity) as PixiContainer;

    mock.api.invalidate(entity);
    object.visible = false;

    expect(mock.api.sync.renderPasses()).toBe(1);
  });

  it("counts what a picture draws while it is taken, and what the frame draws after it", async () => {
    const { mock, entity, hidden } = await filteredSprite();
    const view = mock.ctx.state.sync.views.get(entity);

    if (view === undefined) throw new Error("no view");

    swapHidden(hidden, view, "freeze", true);
    expect(mock.api.sync.renderPasses()).toBe(1);

    const top = (view.wrapper ?? view.object) as PixiContainer;
    const during = liftFor(hidden, [top], [], "freeze", () => mock.api.sync.renderPasses());

    expect([during, mock.api.sync.renderPasses()]).toEqual([3, 1]);
  });
});
