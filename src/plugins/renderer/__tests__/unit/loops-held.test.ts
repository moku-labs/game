import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HudPart, Overlay, Shape, Transform } from "../../components";
import type { FilterSlot } from "../../sync/types";
import { createMockRenderer } from "../mock-renderer";
import { endStage, type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: `renderer.sync.loopsHeld(entity)` (spec 22 O9.2): true for a view an opaque cover hides and for a view in
// the held picture of a blurred range or of a range whose owner has `hold: true` (and both touch the range); false
// under a dim-only overlay over a sharp scene without `hold`, above the overlay, in the HUD layer, and with no
// overlay. Blurred is read from the slots' `blurs`.
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

  // Bug (F41): a dimmed sheet over a sharp scene lets the loops under it write in every frame, so the scene is drawn
  // under a resting sheet; or the hold reaches past the sheet, or does not touch the range, so the loops never write
  // their catch-up frame when it leaves and stand where they were held.
  it("holds a view under a landed dim-only overlay with hold over a sharp scene and touches the range; not a view above it, nor in its first exit frame", async () => {
    const stage = await stageOf();
    const sync = stage.drawn.mock.api.sync;
    const glint = stage.view({ order: 1 });
    const shop = stage.overlay({ dim: 0.56, hold: true }, { order: 2 });
    const above = stage.view({ order: 3 });

    stage.level(shop, 1, true);
    stage.frames(2);

    const range = stage.drawn.mock.ctx.state.sync.overlay.active;

    expect(range).toMatchObject({ owner: shop, kept: true, blurred: false, touched: false });
    expect([sync.loopsHeld(glint), sync.loopsHeld(above)]).toEqual([true, false]);
    expect(range?.touched).toBe(true);

    stage.leave(shop);
    stage.frame();

    expect(sync.loopsHeld(glint)).toBe(false);
  });

  // Bug: the hold of a sheet under the top one holds the loops of a range it does not own (the top sheet never asked),
  // or the top sheet's hold is missed because the sheet under it has none.
  it("reads only the hold of the range's owner, the top sheet", async () => {
    const stage = await stageOf();
    const ecs = stage.drawn.mock.world.ecs;
    const sync = stage.drawn.mock.api.sync;
    const glint = stage.view({ order: 1 });
    const shop = stage.overlay({ dim: 0.56 }, { order: 2 });
    const settings = stage.overlay({ dim: 0.3, hold: true }, { order: 4 });

    stage.level(shop, 1, true);
    stage.level(settings, 1, true);
    stage.frames(2);

    expect(stage.drawn.mock.ctx.state.sync.overlay.active?.owner).toBe(settings);
    expect(sync.loopsHeld(glint)).toBe(true);

    ecs.set(shop, Overlay, { hold: true });
    ecs.set(settings, Overlay, { hold: false });
    stage.frame();

    expect(sync.loopsHeld(glint)).toBe(false);
  });

  // Bug: a game in plain JS writes `hold: "yes"` and the truthy string holds the loops, with no word in the log.
  it("reads a hold that is no boolean as false, with one dev warning", async () => {
    const stage = await stageOf({ dev: true });
    const warn = vi.spyOn(stage.drawn.mock.log, "warn");
    const glint = stage.view({ order: 1 });
    const shop = stage.overlay({ dim: 0.56, hold: "yes" as unknown as boolean }, { order: 2 });

    stage.level(shop, 1, true);
    stage.frames(3);

    expect(stage.drawn.mock.api.sync.loopsHeld(glint)).toBe(false);
    expect(warn.mock.calls.filter(([code]) => code === "renderer:overlay-value")).toEqual([
      ["renderer:overlay-value", { entity: shop, field: "hold" }]
    ]);
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

  // Bug: the range of a sheet drawn live by the fallback (three retakes in a row) lets its loops write, so it never
  // comes back to its picture; or the hold goes too far and freezes loops the player sees sharp, or keeps them frozen
  // while the sheet leaves.
  it("holds the loops of a blurred range the fallback draws live; not those of a sharp one, nor once its overlay leaves", async () => {
    const stage = await stageOf();
    const sync = stage.drawn.mock.api.sync;
    const ecs = stage.drawn.mock.world.ecs;
    const glint = stage.view({ order: 1 });
    const burst = (entity: number): void => {
      for (let frame = 1; frame <= 3; frame += 1) {
        ecs.set(entity, Shape, { fill: 0x10_20_30 + frame });
        stage.frame();
      }
    };
    const dimOnly = stage.overlay({ dim: 0.56 }, { order: 2 });

    stage.level(dimOnly, 1, true);
    stage.frames(2);
    burst(glint);
    expect(stage.drawn.mock.ctx.state.sync.overlay.active?.fallback).toBe(true);
    expect(sync.loopsHeld(glint)).toBe(false);

    ecs.despawn(dimOnly);
    stage.frame();

    const frost = stage.view({ order: 1, w: 1080, h: 1920 });

    sync.filters.set(frost, [slotOf({ blurs: true })]);

    const shop = stage.overlay({ dim: 0.56 }, { order: 2 });

    stage.level(shop, 1, true);
    stage.frames(2);
    burst(frost);
    expect(stage.drawn.mock.ctx.state.sync.overlay.active?.fallback).toBe(true);
    expect(sync.loopsHeld(glint)).toBe(true);

    stage.leave(shop);
    stage.frame();
    expect(sync.loopsHeld(glint)).toBe(false);
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

describe("loopsHeld — views the player cannot see (spec 26 R1.7)", () => {
  it("holds the loops of a view at alpha 0; a loop that writes its alpha is not held", async () => {
    const stage = await stageOf();
    const sync = stage.drawn.mock.api.sync;
    const glint = stage.view({ order: 1, alpha: 0 });

    stage.frames(2);

    expect(sync.loopsHeld(glint)).toBe(true);
    expect(sync.loopsHeld(glint, "place")).toBe(true);
    expect(sync.loopsHeld(glint, "alpha")).toBe(false);
    expect(sync.loopsHeld(glint, "both")).toBe(false);
  });

  it("holds every loop of a view under a view at alpha 0, reveals or not", async () => {
    const stage = await stageOf();
    const sync = stage.drawn.mock.api.sync;
    const panel = stage.view({ order: 1, alpha: 0 });
    const glint = stage.view({ parent: panel, w: 20, h: 20 });

    stage.frames(2);

    expect([
      sync.loopsHeld(glint),
      sync.loopsHeld(glint, "alpha"),
      sync.loopsHeld(glint, "place"),
      sync.loopsHeld(glint, "both")
    ]).toEqual([true, true, true, true]);
  });

  it("holds the loops of a HUD part faded to factor 0", async () => {
    const stage = await stageOf();
    const sync = stage.drawn.mock.api.sync;
    const gems = stage.view({ layer: "hud", x: 100, y: 100, extra: [HudPart({ key: "gems" })] });
    const shop = stage.overlay({ hud: "none" });

    stage.frames(2);
    expect(sync.loopsHeld(gems)).toBe(false);

    stage.level(shop, 1);
    stage.frame();

    expect(sync.loopsHeld(gems)).toBe(true);
    expect(sync.loopsHeld(gems, "alpha")).toBe(false);
  });

  it("holds the loops of a leaf wholly off the screen; a loop that writes its place is not held", async () => {
    const stage = await stageOf();
    const sync = stage.drawn.mock.api.sync;
    const comet = stage.view({ order: 1, x: 5000, y: 100 });

    stage.frames(2);

    expect(sync.loopsHeld(comet)).toBe(true);
    expect(sync.loopsHeld(comet, "alpha")).toBe(true);
    expect(sync.loopsHeld(comet, "place")).toBe(false);
    expect(sync.loopsHeld(comet, "both")).toBe(false);
  });

  it("does not hold a leaf whose filter padding reaches the screen, nor a view with children off the screen", async () => {
    const stage = await stageOf();
    const sync = stage.drawn.mock.api.sync;
    const light = stage.view({ order: 1, x: 1085, y: 100 });
    const filter = new pixi.AlphaFilter();
    const panel = stage.view({ order: 1, x: 5000, y: 100 });

    stage.view({ parent: panel, w: 20, h: 20 });
    filter.padding = 10;
    sync.filters.set(light, [slotOf({ filter })]);
    stage.frames(2);

    expect(sync.loopsHeld(light)).toBe(false);
    expect(sync.loopsHeld(panel)).toBe(false);
  });

  it("does not hold a view hidden by empty or kept, nor a view out of the tree", async () => {
    const stage = await stageOf({ onDemand: false });
    const sync = stage.drawn.mock.api.sync;
    const empty = stage.view({ order: 1, extra: [] });
    const lamp = stage.view({ order: 1, x: 300, y: 300 });
    const lost = stage.view({ layer: "nowhere" });

    stage.drawn.mock.world.ecs.set(empty, Shape, { fillAlpha: 0 });
    sync.filters.set(lamp, [slotOf({ cache: "local" })]);
    stage.frames(8);

    expect(stage.drawn.mock.ctx.state.kept.byEntity.get(lamp)?.mode).toBe("kept");
    expect(stage.drawn.mock.ctx.state.sync.views.get(empty)?.object.renderable).toBe(false);
    expect([sync.loopsHeld(empty), sync.loopsHeld(lamp), sync.loopsHeld(lost)]).toEqual([
      false,
      false,
      false
    ]);
  });

  it("answers the overlay cases the same with or without reveals", async () => {
    const stage = await stageOf();
    const sync = stage.drawn.mock.api.sync;
    const glint = stage.view({ layer: "scene" });
    const sheet = stage.overlay({ cover: "opaque" }, { order: 2 });

    stage.level(sheet, 1, true);
    stage.frames(2);

    expect([
      sync.loopsHeld(glint),
      sync.loopsHeld(glint, "alpha"),
      sync.loopsHeld(glint, "place"),
      sync.loopsHeld(glint, "both")
    ]).toEqual([true, true, true, true]);
  });

  // E4 of change 2026-10-18-render-path-garbage: the answer is kept across a still frame, no longer walked every frame.
  it("walks an entity with several loops once, and again only after a frame that changed the tree", async () => {
    const stage = await stageOf();
    // The module the frames drive, built with the demand module the spy watches.
    const sync = stage.drawn.mock.modules.sync;
    const glint = stage.view({ order: 1, alpha: 0 });

    stage.frames(2);

    const walk = vi.spyOn(stage.drawn.mock.modules.demand, "unseenBy");

    sync.loopsHeld(glint);
    sync.loopsHeld(glint, "alpha");
    sync.loopsHeld(glint, "place");

    expect(walk).toHaveBeenCalledTimes(1);

    stage.frame();
    sync.loopsHeld(glint);
    sync.loopsHeld(glint, "both");

    expect(walk).toHaveBeenCalledTimes(1);

    stage.drawn.mock.world.ecs.set(glint, Transform, { x: 40 });
    stage.frame();
    sync.loopsHeld(glint);
    sync.loopsHeld(glint, "both");

    expect(walk).toHaveBeenCalledTimes(2);
  });

  it("answers false while inert and for an entity without a view", async () => {
    const inert = createMockRenderer({ dom: false });

    expect(inert.api.sync.loopsHeld(1_048_576)).toBe(false);

    const stage = await stageOf();

    stage.frames(2);

    expect(stage.drawn.mock.api.sync.loopsHeld(1_048_999)).toBe(false);
  });
});
