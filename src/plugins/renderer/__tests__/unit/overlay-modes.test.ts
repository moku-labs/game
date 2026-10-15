import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Shape, Transform } from "../../components";
import { hiddenBy } from "../../sync/hidden";
import { endStage, type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: the mode of an overlay and the one range at a time (spec 22 O5.3–O5.5, O8.2, O8.4): cover only when an
// opaque overlay has landed, is not leaving and is drawn whole; live from its first exit frame; one picture, the top
// overlay's; the live fallback; a refused picture. Real Pixi; every frame checked for K3.
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
 * The reports of the overlays now.
 *
 * @param stage - The stage.
 * @returns The reports, bottom first.
 */
function reports(stage: OverlayStage) {
  return stage.drawn.mock.api.sync.debug.overlays();
}

/**
 * The mode one overlay is reported in.
 *
 * @param stage - The stage.
 * @param entity - The overlay.
 * @returns Its mode.
 */
function modeOf(stage: OverlayStage, entity: Entity): string | undefined {
  return reports(stage).find(report => report.entity === entity)?.mode;
}

describe("overlay modes", () => {
  it("an opaque overlay covers only when it has landed, is not leaving and is drawn at alpha 1", async () => {
    const stage = await stageOf();
    const under = stage.view({ order: 1 });
    const sheet = stage.overlay({ cover: "opaque" }, { order: 2 });

    // Sliding in at alpha 1, not landed: kept as a picture.
    stage.level(sheet, 1);
    stage.frames(2);
    expect(modeOf(stage, sheet)).toBe("freeze");

    // Landed, but a game's own fade holds it at 0.4.
    stage.drawn.mock.world.ecs.set(sheet, Shape, { alpha: 0.4 });
    stage.level(sheet, 1, true);
    stage.frames(2);
    expect(modeOf(stage, sheet)).toBe("freeze");

    // Landed and whole: nothing under it is drawn, and no picture is held.
    stage.drawn.mock.world.ecs.set(sheet, Shape, { alpha: 1 });
    stage.frames(2);
    expect(modeOf(stage, sheet)).toBe("cover");
    expect(stage.topOf(under).renderable).toBe(false);
    expect(stage.drawn.mock.modules.kept.kept(sheet)).toBe(false);
  });

  it("an AlphaFilter below 1 on the opaque root keeps it from covering", async () => {
    const stage = await stageOf();
    const sheet = stage.overlay({ cover: "opaque" }, { order: 2 });
    const fade = new pixi.AlphaFilter({ alpha: 0.4 });

    stage.drawn.mock.api.sync.filters.set(sheet, [{ filter: fade, passes: 1 }]);
    stage.level(sheet, 1, true);
    stage.frames(2);
    expect(modeOf(stage, sheet)).toBe("freeze");

    fade.alpha = 1;
    stage.frames(2);
    expect(modeOf(stage, sheet)).toBe("cover");
  });

  it("reads the AlphaFilter of a kept root where it hangs now: on its stand-in", async () => {
    const stage = await stageOf({ onDemand: false });
    const sheet = stage.overlay({ cover: "opaque" }, { order: 2, w: 200, h: 200 });
    const fade = new pixi.AlphaFilter({ alpha: 0.4 });

    stage.drawn.mock.api.sync.filters.set(sheet, [{ filter: fade, passes: 1, cache: "local" }]);
    stage.level(sheet, 1, true);
    stage.frames(6);

    const view = stage.drawn.mock.ctx.state.sync.views.get(sheet);

    if (view === undefined) throw new Error("no view");

    expect(stage.drawn.mock.modules.kept.filterTarget(view)).not.toBe(stage.topOf(sheet));
    expect(modeOf(stage, sheet)).toBe("freeze");
  });

  it("an opaque overlay is live from its first exit frame; a non-opaque one keeps its picture through its exit", async () => {
    const stage = await stageOf();
    const under = stage.view({ order: 1 });
    const sheet = stage.overlay({ cover: "opaque" }, { order: 2 });

    stage.level(sheet, 1, true);
    stage.frames(2);
    expect(modeOf(stage, sheet)).toBe("cover");

    stage.leave(sheet);
    stage.frame();
    expect(modeOf(stage, sheet)).toBe("live");
    expect(stage.topOf(under).renderable).toBe(true);

    const shop = stage.overlay({ dim: 0.5 }, { order: 3 });

    stage.level(shop, 1, true);
    stage.frames(2);
    stage.leave(shop);
    stage.level(shop, 0.5);
    stage.frames(2);

    expect(reports(stage).find(report => report.entity === shop)).toMatchObject({
      phase: "exiting",
      mode: "freeze",
      kept: true
    });
  });

  it("landing turns freeze into cover in one step: the range is hidden in the stage pass of that frame, its picture gone", async () => {
    const stage = await stageOf();
    const under = stage.view({ order: 1 });
    const sheet = stage.overlay({ cover: "opaque" }, { order: 2 });
    const seen: boolean[] = [];

    stage.level(sheet, 1);
    stage.frames(2);
    stage.drawn.stage.last().renderer.watchers.push(call => {
      if (call.target === undefined) seen.push(stage.topOf(under).renderable);
    });
    stage.level(sheet, 1, true);
    stage.frame();

    expect(seen).toEqual([false]);
    expect(modeOf(stage, sheet)).toBe("cover");
    expect(stage.drawn.mock.modules.kept.kept(sheet)).toBe(false);

    const view = stage.drawn.mock.ctx.state.sync.views.get(under);

    expect(
      view === undefined ? undefined : [hiddenBy(view, "cover"), hiddenBy(view, "freeze")]
    ).toEqual([true, false]);
  });

  it("keeps one picture, the top overlay's: the lower overlay is an entry of it", async () => {
    const stage = await stageOf();
    const shop = stage.overlay({ dim: 0.4 }, { order: 1 });
    const settings = stage.overlay({ dim: 0.4, hud: "none" }, { order: 2 });

    stage.level(shop, 1, true);
    stage.level(settings, 1, true);
    stage.frames(2);

    expect(reports(stage)).toMatchObject([
      { entity: shop, mode: "live", range: 0, kept: false },
      { entity: settings, mode: "freeze", kept: true }
    ]);
    expect(stage.drawn.mock.ctx.state.sync.overlay.active?.entries).toContain(stage.topOf(shop));
  });

  it("the top overlay leaving opaque lets the one below keep its own range in the same frame", async () => {
    const stage = await stageOf();
    const under = stage.view({ order: 1 });
    const shop = stage.overlay({ dim: 0.4 }, { order: 2 });
    const sheet = stage.overlay({ cover: "opaque" }, { order: 3 });

    stage.level(shop, 1, true);
    stage.level(sheet, 1, true);
    stage.frames(2);
    expect(modeOf(stage, sheet)).toBe("cover");

    stage.leave(sheet);
    stage.frame();

    expect(reports(stage)).toMatchObject([
      { entity: shop, mode: "freeze", kept: true },
      { entity: sheet, mode: "live" }
    ]);
    expect(stage.topOf(under).renderable).toBe(false);
    expect(stage.topOf(shop).renderable).toBe(true);
  });

  it("the top overlay gone, the one below takes its picture in the same frame", async () => {
    const stage = await stageOf();
    const shop = stage.overlay({ dim: 0.4 }, { order: 1 });
    const settings = stage.overlay({ dim: 0.4 }, { order: 2 });

    stage.level(shop, 1, true);
    stage.level(settings, 1, true);
    stage.frames(2);

    const from = stage.mark();

    stage.drawn.mock.world.ecs.despawn(settings);
    stage.frame();

    expect(reports(stage)).toMatchObject([{ entity: shop, mode: "freeze", kept: true }]);
    expect(stage.rootRenders(from)).toHaveLength(1);
    expect(stage.drawn.mock.modules.kept.kept(settings)).toBe(false);
  });

  it("draws a range retaken for a mark in three frames in a row live, and keeps it again after eight calm frames", async () => {
    const stage = await stageOf({ agent: true });
    const fog = stage.view({ order: 1 });
    const shop = stage.overlay({ dim: 0.4 }, { order: 2 });
    const ecs = stage.drawn.mock.world.ecs;

    stage.level(shop, 1, true);
    stage.frames(2);

    for (let frame = 1; frame <= 2; frame += 1) {
      ecs.set(fog, Transform, { x: frame });
      stage.frame();
      expect(stage.topOf(fog).renderable).toBe(false);
    }

    ecs.set(fog, Transform, { x: 3 });
    stage.frame();

    expect(stage.topOf(fog).renderable).toBe(true);
    expect(reports(stage)[0]).toMatchObject({ mode: "live", kept: false });

    stage.frames(7);
    expect(stage.topOf(fog).renderable).toBe(true);

    stage.frame();
    expect(stage.topOf(fog).renderable).toBe(false);
    expect(reports(stage)[0]).toMatchObject({ mode: "freeze", kept: true });
  });

  it("draws a range live when kept refuses its picture, with one debug line, writing no freeze reason before it asked", async () => {
    const stage = await stageOf({ config: { keptMb: 0.001 } });
    const under = stage.view({ order: 1 });
    const debug = vi.spyOn(stage.drawn.mock.log, "debug");
    const shop = stage.overlay({ dim: 0.4 }, { order: 2 });
    const hiddenAtRender: boolean[] = [];

    stage.drawn.stage.last().renderer.watchers.push(() => {
      hiddenAtRender.push(!stage.topOf(under).renderable);
    });
    stage.level(shop, 1, true);
    stage.frames(3);

    const view = stage.drawn.mock.ctx.state.sync.views.get(under);

    expect(hiddenAtRender.every(hidden => !hidden)).toBe(true);
    expect(view === undefined ? true : hiddenBy(view, "freeze")).toBe(false);
    expect(debug.mock.calls.filter(([code]) => code === "renderer:overlay-live")).toEqual([
      ["renderer:overlay-live", { entity: shop, reason: "refused" }]
    ]);
    expect(reports(stage)[0]).toMatchObject({ mode: "live", range: 0, kept: false });
  });
});
