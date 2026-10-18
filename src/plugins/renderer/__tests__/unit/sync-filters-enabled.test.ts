import * as pixi from "pixi.js";
import { afterEach, describe, expect, it } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Sprite, Transform } from "../../components";
import type { FilterSlot, PixiContainer, PixiFilter } from "../../types";
import { FakeFilter } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";
import { endStage, type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: Pixi is handed only the enabled filters of a view (E3 of change 2026-10-18-render-path-garbage). A
// disabled filter draws nothing, but a filter Pixi holds is pushed and popped around its view every frame, two batch
// breaks and a closure; a view whose filters are all disabled holds none. A switch is written by the frame's step
// before the frame is drawn.
// ---------------------------------------------------------------------------

const running: OverlayStage[] = [];

afterEach(() => {
  for (const stage of running.splice(0)) endStage(stage);
});

const owner = { kind: "plugin", name: "test" } as const;

/**
 * Starts a mock renderer with one layer, "items", and one sprite in it, built.
 *
 * @returns The started mock and the sprite.
 */
async function startedWithSprite(): Promise<{ mock: MockRenderer; entity: Entity }> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform(),
    Sprite({ texture: "board.cell" })
  ]);

  mock.modules.sync.pass();

  return { mock, entity };
}

/**
 * One slot of a fake filter.
 *
 * @param filter - The fake filter.
 * @returns The slot.
 */
function slot(filter: FakeFilter): FilterSlot {
  return { filter: filter as unknown as PixiFilter, passes: 1 };
}

/**
 * A fake filter switched off, as a button's press dim waits.
 *
 * @returns The filter.
 */
function disabled(): FakeFilter {
  const filter = new FakeFilter();

  filter.enabled = false;

  return filter;
}

/**
 * What Pixi's build of a container's children asks of the render pipes, in order: `pipe.method` per call.
 *
 * @param container - The container whose children are collected, as a render group collects its root's.
 * @returns The calls.
 */
function pipeCalls(container: PixiContainer): string[] {
  const calls: string[] = [];
  const renderPipes = new Proxy(
    {},
    {
      get: (_target, pipe: string) =>
        new Proxy(
          {},
          {
            get: (_inner, method: string) => (): void => {
              calls.push(`${pipe}.${method}`);
            }
          }
        )
    }
  );
  const instructions = new pixi.InstructionSet();

  (container as unknown as pixi.Container).collectRenderablesSimple(
    instructions,
    { renderPipes } as unknown as pixi.Renderer,
    // No render layer, as a render group collects its root; Pixi compares it with each child's own.
    undefined as unknown as pixi.RenderLayer
  );

  return calls;
}

describe("the filters Pixi is handed", () => {
  // Bug: a view whose only filter is switched off keeps a filter effect, pushed and popped by Pixi every frame.
  it("are the enabled ones: none for a view whose filters are all disabled, and nothing is written for it", async () => {
    const { mock, entity } = await startedWithSprite();
    const object = mock.api.sync.displayOf(entity) as { filters: unknown; filterWrites: number };
    const glow = new FakeFilter();
    const dim = disabled();

    mock.api.sync.filters.set(entity, [slot(dim)]);

    expect(object.filterWrites).toBe(0);
    expect(object.filters ?? undefined).toBeUndefined();

    mock.api.sync.filters.set(entity, [slot(dim), slot(glow)]);

    expect(object.filters).toEqual([glow]);
  });

  // Bug: the switch is never handed to Pixi (the dim of a press never shows), or written again every frame.
  it("are written again by the frame's step when a filter is switched, once, and not by a frame with no switch", async () => {
    const { mock, entity } = await startedWithSprite();
    const object = mock.api.sync.displayOf(entity) as { filters: unknown; filterWrites: number };
    const dim = disabled();

    mock.api.sync.filters.set(entity, [slot(dim)]);
    dim.enabled = true;

    expect(object.filters ?? undefined).toBeUndefined();

    mock.modules.sync.stepFilters();

    expect(object.filters).toEqual([dim]);

    mock.modules.sync.stepFilters();

    expect(object.filterWrites).toBe(1);

    dim.enabled = false;
    mock.modules.sync.stepFilters();

    expect(object.filters).toBeNull();
    expect(object.filterWrites).toBe(2);
  });

  // Bug: the step moves nothing on, so a walk of `shown` keeps the paddings of the filters before the switch.
  it("moves the render-pass version on when a switch is written, and not when nothing was switched", async () => {
    const { mock, entity } = await startedWithSprite();
    const dim = disabled();

    mock.api.sync.filters.set(entity, [slot(dim)]);

    const before = mock.ctx.state.sync.passesVersion;

    mock.modules.sync.stepFilters();

    expect(mock.ctx.state.sync.passesVersion).toBe(before);

    dim.enabled = true;
    mock.modules.sync.stepFilters();

    expect(mock.ctx.state.sync.passesVersion).toBe(before + 1);
  });
});

describe("buttons with a press dim, over the real Pixi module", () => {
  // The game's case: every button carries a ColorMatrix switched off, on only while pressed. Bug: Pixi pushes and pops
  // each disabled dim around its button, so the buttons never batch; or a press dims a frame late, or never.
  it("collect as one run with no filter; a press dims its button in the frame it is made, a release takes it off", async () => {
    const stage = await startOverlayStage();

    running.push(stage);

    const { api } = stage.drawn.mock;
    const buttons: Entity[] = [];
    const dims: pixi.ColorMatrixFilter[] = [];

    for (let index = 0; index < 12; index += 1) {
      buttons.push(stage.view({ order: 1, x: (index % 4) * 200, y: Math.floor(index / 4) * 200 }));
    }

    stage.frame();

    for (const button of buttons) {
      const dim = new pixi.ColorMatrixFilter();

      dim.enabled = false;
      dims.push(dim);
      api.sync.filters.set(button, Object.freeze([{ filter: dim, passes: 1 }]));
    }

    stage.frames(2);

    const ui = stage.layer("ui");
    const pressed = buttons[5] ?? 0;
    const dim = dims[5] as pixi.ColorMatrixFilter;
    let drawnWith: unknown;

    expect(pipeCalls(ui).filter(call => call.startsWith("filter."))).toEqual([]);
    expect(pipeCalls(ui).filter(call => call === "graphics.addRenderable")).toHaveLength(12);

    stage.drawn.stage.last().renderer.watchers.push(call => {
      if (call.target === undefined) drawnWith = stage.topOf(pressed).filters;
    });

    // The press: `effects` tells the renderer first, then switches the dim on.
    api.invalidate(pressed);
    dim.enabled = true;

    expect(stage.frame()).toBe(true);
    expect(drawnWith).toEqual([dim]);
    expect(pipeCalls(ui).filter(call => call.startsWith("filter."))).toEqual([
      "filter.push",
      "filter.pop"
    ]);

    api.invalidate(pressed);
    dim.enabled = false;

    expect(stage.frame()).toBe(true);
    expect(drawnWith ?? undefined).toBeUndefined();
    expect(pipeCalls(ui).filter(call => call.startsWith("filter."))).toEqual([]);
  });
});
