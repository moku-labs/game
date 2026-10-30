import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Shape, Sprite, Transform } from "../../components";
import type { FilterSlot, PixiFilter } from "../../types";
import { type Drawn, startDrawn } from "../demand-harness";
import { FakeFilter } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// F126 stage 0: where nothing counts (headless, a test stage, the fake application) `stats().canvasPasses` is the
// estimate of the filter slots: 1 for the frame, 1 for every view drawn live with an enabled filter, the walk of
// `sync.renderPasses()`. Bug these catch: the estimate drifts from that walk.
// ---------------------------------------------------------------------------

const owner = { kind: "plugin", name: "test" } as const;

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.mock.stop();
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A started mock with `count` sprites, each with one filter the cache may not keep: all of them drawn live.
 *
 * @param count - The sprites.
 * @returns The mock.
 */
async function liveSprites(count: number): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  for (let index = 0; index < count; index += 1) {
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "board.cell" })
    ]);

    mock.modules.sync.pass();
    mock.api.sync.filters.set(entity, [
      { filter: new FakeFilter() as unknown as PixiFilter, passes: 3 }
    ]);
  }

  return mock;
}

/**
 * A 40 x 40 shape with a filter over the real Pixi of the stage, every frame drawn.
 *
 * @param slot - Its filter slot.
 * @returns The renderer and the entity, built.
 */
async function drawnView(slot: () => FilterSlot): Promise<{ drawn: Drawn; entity: Entity }> {
  const drawn = await startDrawn({ onDemand: false });

  running.push(drawn);

  const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

  drawn.mock.api.sync.filters.set(entity, [slot()]);
  drawn.frame();

  return { drawn, entity };
}

describe("the estimate of the canvas passes", () => {
  it("is 0 while inert", () => {
    const mock = createMockRenderer();

    expect(mock.api.stats()).toMatchObject({ canvasPasses: 0, canvasPassesMax: 0 });
  });

  // Bug: the frame's own pass is left out, or every filter's apply counts as a break.
  it("is 1 without a filter, 2 with one live view, 11 with ten, however many applies each has", async () => {
    const none = await liveSprites(0);
    const one = await liveSprites(1);

    expect(none.modules.sync.canvasPasses()).toBe(1);
    expect(one.modules.sync.canvasPasses()).toBe(2);
    none.stop();
    one.stop();

    const ten = await liveSprites(10);

    expect(ten.api.stats()).toMatchObject({ canvasPasses: 11, canvasPassesMax: 11 });
    ten.stop();
  });

  // Bug: a view that is not drawn counts, as a view inside a hidden layer would: the walk of `renderPasses` skips it.
  it("adds nothing for a view not drawn, and nothing for a filter switched off", async () => {
    const mock = await liveSprites(2);
    const [first, second] = mock.ctx.state.sync.filters.keys();

    (mock.api.sync.displayOf(first as Entity) as { visible: boolean }).visible = false;
    expect(mock.modules.sync.canvasPasses()).toBe(2);

    const slots = mock.ctx.state.sync.filters.get(second as Entity) ?? [];

    (slots[0]?.filter as unknown as { enabled: boolean }).enabled = false;
    expect(mock.modules.sync.canvasPasses()).toBe(1);
    mock.stop();
  });

  // Bug: a kept view costs the canvas no break: it is one quad of the canvas pass.
  it("adds nothing for a kept view", async () => {
    const { drawn, entity } = await drawnView(() => ({
      filter: new pixi.ColorMatrixFilter(),
      passes: 1,
      cache: "local"
    }));

    drawn.frames(2);

    expect(drawn.mock.ctx.state.kept.byEntity.get(entity)?.mode).toBe("kept");
    expect(drawn.mock.api.stats().canvasPasses).toBe(1);
  });

  // Bug: a stack of alphas drawn by its quad (F54) counts as a filter: it has no filter pass at all.
  it("adds nothing for a direct Alpha-only view", async () => {
    const { drawn, entity } = await drawnView(() => ({
      filter: new pixi.AlphaFilter(),
      passes: 1,
      cache: "local"
    }));

    drawn.frame();

    expect(drawn.mock.ctx.state.kept.byEntity.get(entity)?.direct).toBe(true);
    expect(drawn.mock.api.stats().canvasPasses).toBe(1);
  });

  // Bug (R7): the estimate reads the cache of `renderPassesOf`, which a take does not move: the kept view stays a break.
  it("sees a take at once, with no change of the slots between two reads", async () => {
    const { drawn } = await drawnView(() => ({
      filter: new pixi.ColorMatrixFilter(),
      passes: 1,
      cache: "local"
    }));

    expect(drawn.mock.modules.sync.canvasPasses()).toBe(2);

    drawn.frames(2);

    expect(drawn.mock.modules.sync.canvasPasses()).toBe(1);
  });
});
