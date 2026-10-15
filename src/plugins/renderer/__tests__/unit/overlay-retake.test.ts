import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { component, Layer, Order } from "../../../world/ecs/define";
import { Shape } from "../../components";
import { endStage, type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: when the picture of a range is taken again (spec 22 O8.3, K1, F13): in the frame a view in it changes
// (adapter marks too) and that frame drawn; never for a change above it or in the HUD; for a root that comes under
// it; for a resize, a restore, the outline switch; and the held loops caught up at landing and at the first exit
// frame. The renders of the stage root into a texture are the takes.
// ---------------------------------------------------------------------------

const running: OverlayStage[] = [];

afterEach(() => {
  for (const stage of running.splice(0)) endStage(stage);
  vi.unstubAllGlobals();
});

/** A label a plugin above draws its own way: its adapter redraws on every new text. */
const Label = component("test.label", { text: "" });

/**
 * Starts a stage with a landed shop over one view, at rest: no frame is drawn while nothing changes.
 *
 * @param blurs - True to give the view under the shop a blurring filter: the range is blurred.
 * @returns The stage, the view under the shop, the shop, and a view above it.
 */
async function restingShop(blurs = false) {
  const stage = await startOverlayStage();

  running.push(stage);

  const under = stage.view({ order: 1 });
  const shop = stage.overlay({ dim: 0.56 }, { order: 2 });
  const above = stage.view({ order: 3 });
  const hud = stage.view({ layer: "hud" });

  if (blurs) {
    stage.drawn.mock.api.sync.filters.set(under, [
      { filter: new pixi.AlphaFilter(), passes: 1, blurs: true }
    ]);
  }

  stage.level(shop, 1, true);
  stage.frames(3);

  return { stage, under, shop, above, hud };
}

describe("overlay retakes", () => {
  it("a shop at rest draws no frame and takes no picture", async () => {
    const { stage } = await restingShop();
    const from = stage.mark();

    expect(stage.frames(20)).toBe(0);
    expect(stage.rootRenders(from)).toHaveLength(0);
  });

  it("takes the picture again in the frame a view under the dim changes, and draws that frame", async () => {
    const { stage, under } = await restingShop();
    const from = stage.mark();

    stage.drawn.mock.world.ecs.set(under, Shape, { fill: 0xff_00_00 });

    expect(stage.frame()).toBe(true);
    expect(stage.rootRenders(from)).toHaveLength(1);
  });

  it("takes it again when the adapter of a label under the dim redraws it", async () => {
    const stage = await startOverlayStage();

    running.push(stage);

    const off = stage.drawn.mock.api.sync.displays.provide(Label, {
      create: () => new pixi.Graphics().rect(0, 0, 10, 10).fill(0xff_ff_ff),
      update: (_object, previous, next) => previous.text !== next.text,
      destroy: object => (object as pixi.Container).destroy()
    });
    const label = stage.drawn.mock.world.ecs.spawn({ kind: "plugin", name: "ui" }, [
      Label({ text: "3" }),
      Layer({ name: "ui" }),
      Order({ value: 1 })
    ]);
    const shop = stage.overlay({ dim: 0.56 }, { order: 2 });

    stage.level(shop, 1, true);
    stage.frames(3);

    const from = stage.mark();

    stage.drawn.mock.world.ecs.set(label, Label, { text: "4" });

    expect(stage.frame()).toBe(true);
    expect(stage.rootRenders(from)).toHaveLength(1);
    off();
  });

  it("takes the picture again when a view in a lower layer goes, and when a view moves out of the range", async () => {
    const { stage } = await restingShop();
    const ecs = stage.drawn.mock.world.ecs;
    const tree = stage.view({ layer: "scene", x: 500 });
    const leaf = stage.view({ layer: "scene", x: 700 });

    stage.frames(3);

    let from = stage.mark();

    ecs.despawn(tree);
    expect(stage.frame()).toBe(true);
    expect(stage.rootRenders(from)).toHaveLength(1);

    from = stage.mark();
    ecs.set(leaf, Layer, { name: "hud" });
    stage.frame();
    expect(stage.rootRenders(from)).toHaveLength(1);
    expect(stage.topOf(leaf).renderable).toBe(true);
  });

  it("takes nothing for a change above the overlay or in the HUD layer", async () => {
    const { stage, above, hud } = await restingShop();
    const from = stage.mark();

    stage.drawn.mock.world.ecs.set(above, Shape, { fill: 0xff_00_00 });
    stage.drawn.mock.world.ecs.set(hud, Shape, { fill: 0x00_ff_00 });

    expect(stage.frame()).toBe(true);
    expect(stage.rootRenders(from)).toHaveLength(0);
  });

  it("hides a root that comes under the overlay and takes it in in its first frame; one moved above it is shown again", async () => {
    const { stage } = await restingShop();
    const from = stage.mark();
    const late = stage.view({ order: 1, x: 300 });

    stage.frame();

    expect(stage.topOf(late).renderable).toBe(false);
    expect(stage.rootRenders(from)).toHaveLength(1);

    stage.drawn.mock.world.ecs.set(late, Order, { value: 5 });
    stage.frame();

    expect(stage.topOf(late).renderable).toBe(true);
  });

  it("takes it again for a resize, a restore and the outline switch; new layers build the range again", async () => {
    const { stage, shop } = await restingShop();
    const { modules } = stage.drawn.mock;
    let from = stage.mark();

    modules.demand.whole("resize");
    stage.frame();
    expect(stage.rootRenders(from)).toHaveLength(1);

    from = stage.mark();
    stage.drawn.mock.api.sync.debug.nineSlice(true);
    stage.frame();
    expect(stage.rootRenders(from)).toHaveLength(1);

    from = stage.mark();
    stage.drawn.mock.world.projection.setLayers([
      { name: "back", sort: "none" },
      { name: "scene", sort: "none" },
      { name: "ui", sort: "order" },
      { name: "hud", sort: "none", above: "overlays" }
    ]);
    stage.frame();
    expect(stage.drawn.mock.ctx.state.sync.overlay.active?.entries).toContain(stage.layer("back"));
    expect(stage.rootRenders(from)).toHaveLength(1);

    from = stage.mark();
    modules.sync.rebuildAll();
    stage.frame();
    expect(stage.rootRenders(from)).toHaveLength(1);
    expect(stage.drawn.mock.api.sync.debug.overlays()[0]).toMatchObject({
      entity: shop,
      kept: true
    });
  });

  it("catches a loop held on the way in up once after landing, and takes nothing when nothing was held", async () => {
    const stage = await startOverlayStage();

    running.push(stage);

    const glint = stage.view({ order: 1 });
    const shop = stage.overlay({ dim: 0.56 }, { order: 2 });
    const sync = stage.drawn.mock.api.sync;

    sync.filters.set(glint, [{ filter: new pixi.AlphaFilter(), passes: 1, blurs: true }]);
    stage.level(shop, 0.5);
    stage.frames(2);

    expect(sync.loopsHeld(glint)).toBe(true);

    let from = stage.mark();

    stage.level(shop, 1, true);
    stage.frame();
    // The frame after the landing: the held loops write once, and that frame takes them in.
    expect(sync.loopsHeld(glint)).toBe(false);
    stage.frame();
    expect(stage.rootRenders(from)).toHaveLength(1);
    expect(sync.loopsHeld(glint)).toBe(true);

    // A second overlay that lands with nothing held takes nothing.
    stage.drawn.mock.world.ecs.despawn(shop);
    stage.frames(2);

    const quiet = stage.overlay({ dim: 0.56 }, { order: 2 });

    stage.level(quiet, 0.5);
    stage.frames(2);
    from = stage.mark();
    stage.level(quiet, 1, true);
    stage.frames(3);
    expect(stage.rootRenders(from)).toHaveLength(0);
  });

  it("catches a loop held after landing up once at the first exit frame, and takes nothing else on the way out", async () => {
    const { stage, under, shop } = await restingShop(true);
    const sync = stage.drawn.mock.api.sync;

    expect(sync.loopsHeld(under)).toBe(true);

    const from = stage.mark();

    stage.leave(shop);
    stage.level(shop, 0.6);
    stage.frame();
    expect(sync.loopsHeld(under)).toBe(false);
    stage.level(shop, 0.3);
    stage.frame();
    stage.level(shop, 0.1);
    stage.frames(3);

    expect(stage.rootRenders(from)).toHaveLength(1);
  });
});
