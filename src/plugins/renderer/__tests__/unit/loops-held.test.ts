import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FilterSlot } from "../../sync/types";
import { endStage, type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: `renderer.sync.loopsHeld(entity)` (spec 22 O9.2): true for a view an opaque cover hides and for a view in
// the held picture of a blurred range (and it touches the range); false under a dim-only overlay over a sharp scene,
// above the overlay, in the HUD layer, and with no overlay. Blurred is read from the slots' `blurs`.
// ---------------------------------------------------------------------------

const running: OverlayStage[] = [];

afterEach(() => {
  for (const stage of running.splice(0)) endStage(stage);
  vi.unstubAllGlobals();
});

/**
 * Starts a stage the test ends in `afterEach`.
 *
 * @param options - The stage's options.
 * @returns The stage.
 */
async function stageOf(
  options: Parameters<typeof startOverlayStage>[0] = {}
): Promise<OverlayStage> {
  const stage = await startOverlayStage(options);

  running.push(stage);

  return stage;
}

/**
 * A slot of a filter.
 *
 * @param fields - Its fields beyond the filter and one pass.
 * @returns The slot.
 */
function slotOf(fields: Partial<FilterSlot> = {}): FilterSlot {
  return { filter: new pixi.AlphaFilter(), passes: 1, ...fields };
}

describe("loopsHeld", () => {
  it("answers false with no overlay", async () => {
    const stage = await stageOf();
    const glint = stage.view({ order: 1 });

    stage.frames(2);

    expect(stage.drawn.mock.api.sync.loopsHeld(glint)).toBe(false);
  });

  it("holds a view under an opaque cover; under a blurred kept picture it holds it and touches the range", async () => {
    const stage = await stageOf();
    const sync = stage.drawn.mock.api.sync;
    const glint = stage.view({ layer: "scene" });
    const sheet = stage.overlay({ cover: "opaque" }, { order: 2 });

    stage.level(sheet, 1, true);
    stage.frames(2);
    expect(sync.loopsHeld(glint)).toBe(true);

    stage.drawn.mock.world.ecs.despawn(sheet);
    stage.frame();

    const frost = stage.view({ order: 1, w: 1080, h: 1920 });

    sync.filters.set(frost, [slotOf({ blurs: true })]);

    const shop = stage.overlay({ dim: 0.56 }, { order: 2 });

    stage.level(shop, 1, true);
    stage.frames(2);

    const range = stage.drawn.mock.ctx.state.sync.overlay.active;

    expect(range?.touched).toBe(false);
    expect(sync.loopsHeld(glint)).toBe(true);
    expect(range?.touched).toBe(true);
  });

  it("does not hold a view under a dim-only overlay over a sharp scene", async () => {
    const stage = await stageOf();
    const glint = stage.view({ order: 1 });
    const shop = stage.overlay({ dim: 0.56 }, { order: 2 });

    stage.level(shop, 1, true);
    stage.frames(2);

    expect(stage.drawn.mock.api.sync.loopsHeld(glint)).toBe(false);
  });

  it("reads blurred from the slots' blurs, also for a kept view whose filters hang on its stand-in; two passes alone are not blurred", async () => {
    const stage = await stageOf({ onDemand: false });
    const sync = stage.drawn.mock.api.sync;
    const glint = stage.view({ order: 1 });
    const frost = stage.view({ order: 1, w: 200, h: 200 });

    sync.filters.set(frost, [slotOf({ passes: 2 })]);

    const shop = stage.overlay({ dim: 0.56 }, { order: 2 });

    stage.level(shop, 1, true);
    stage.frames(2);
    expect(sync.loopsHeld(glint)).toBe(false);

    // A blurring filter the kept cache keeps: its filters hang on the stand-in, the slot still says blurs.
    sync.filters.set(frost, [slotOf({ blurs: true, cache: "local" })]);
    stage.drawn.mock.world.ecs.despawn(shop);
    stage.frames(6);

    const view = stage.drawn.mock.ctx.state.sync.views.get(frost);

    if (view === undefined) throw new Error("no view");

    expect(stage.drawn.mock.modules.kept.filterTarget(view)).not.toBe(stage.topOf(frost));

    const again = stage.overlay({ dim: 0.56 }, { order: 2 });

    stage.level(again, 1, true);
    stage.frames(2);
    expect(sync.loopsHeld(glint)).toBe(true);
  });

  it("holds a view under a child that covers the canvas with a blurring filter", async () => {
    const stage = await stageOf();
    const sync = stage.drawn.mock.api.sync;
    const ward = stage.view({ order: 1 });
    const fog = stage.view({ parent: ward, w: 1080, h: 1920 });

    sync.filters.set(fog, [slotOf({ blurs: true })]);

    const shop = stage.overlay({ dim: 0.56 }, { order: 2 });

    stage.level(shop, 1, true);
    stage.frames(2);

    expect(sync.loopsHeld(ward)).toBe(true);
  });

  it("does not hold a view above the overlay or in the HUD layer", async () => {
    const stage = await stageOf();
    const sync = stage.drawn.mock.api.sync;
    const sheet = stage.overlay({ cover: "opaque" }, { order: 2 });
    const above = stage.view({ order: 3 });
    const hud = stage.view({ layer: "hud" });

    stage.level(sheet, 1, true);
    stage.frames(2);

    expect([sync.loopsHeld(above), sync.loopsHeld(hud), sync.loopsHeld(sheet)]).toEqual([
      false,
      false,
      false
    ]);
  });
});
