import { afterEach, describe, expect, it, vi } from "vitest";
import { Order } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import type { PixiSprite } from "../../types";
import { endStage, type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: the dim the engine draws for an overlay (spec 22 O6): one quad right under the overlay's root, at
// dim × level in dimColor, the size of the canvas; none under its own cover, none at level 0, gone with the overlay.
// ---------------------------------------------------------------------------

const running: OverlayStage[] = [];

afterEach(() => {
  for (const stage of running.splice(0)) endStage(stage);
  vi.unstubAllGlobals();
});

/**
 * Starts a stage the test ends in `afterEach`.
 *
 * @returns The stage.
 */
async function stageOf(): Promise<OverlayStage> {
  const stage = await startOverlayStage();

  running.push(stage);

  return stage;
}

/**
 * The dim of an overlay.
 *
 * @param stage - The stage.
 * @param entity - The overlay.
 * @returns Its dim, or `undefined`.
 */
function dimOf(stage: OverlayStage, entity: Entity): PixiSprite | undefined {
  return stage.drawn.mock.ctx.state.sync.overlay.records.get(entity)?.dim;
}

describe("overlay dim", () => {
  it("is drawn right under the overlay's root at dim × level in dimColor, and follows a root that moves in the order", async () => {
    const stage = await stageOf();

    stage.view({ order: 1 });

    const shop = stage.overlay({ dim: 0.56, dimColor: 0x1b_14_30 }, { order: 2 });
    const above = stage.view({ order: 3 });

    stage.level(shop, 0.5);
    stage.frames(2);

    const dim = dimOf(stage, shop);
    const layer = stage.layer("ui");
    const root = stage.topOf(shop);

    expect(layer.children[layer.getChildIndex(root) - 1]).toBe(dim);
    expect(dim?.zIndex).toBe(root.zIndex);
    expect(dim?.alpha).toBeCloseTo(0.28, 10);
    expect(dim?.tint).toBe(0x1b_14_30);
    expect(dim?.visible).toBe(true);

    stage.drawn.mock.world.ecs.set(shop, Order, { value: 7 });
    stage.frames(2);

    expect(dim?.zIndex).toBe(7);
    expect(layer.children[layer.getChildIndex(root) - 1]).toBe(dim);
    expect(above).toBeGreaterThan(0);
  });

  it("covers the canvas, and again after a resize", async () => {
    const stage = await stageOf();
    const shop = stage.overlay({ dim: 0.5 });

    stage.level(shop, 1);
    stage.frames(2);

    const dim = dimOf(stage, shop);
    const screen = stage.drawn.stage.last().screen;

    expect(dim?.getBounds()).toMatchObject({
      x: 0,
      y: 0,
      width: screen.width,
      height: screen.height
    });

    const dom = stage.drawn.mock.dom;

    if (dom === undefined) throw new Error("no fake dom");

    dom.mount.clientWidth = 1920;
    dom.mount.clientHeight = 1080;
    dom.observers[0]?.fire();
    stage.frames(2);

    const bounds = dim?.getBounds();

    expect(screen.width).toBe(1920);
    expect(bounds?.x).toBeCloseTo(0, 6);
    expect(bounds?.y).toBeCloseTo(0, 6);
    expect(bounds?.width).toBeCloseTo(1920, 6);
    expect(bounds?.height).toBeCloseTo(1080, 6);
  });

  it("draws no dim under an opaque overlay's own cover, and none at level 0", async () => {
    const stage = await stageOf();
    const sheet = stage.overlay({ dim: 0.5, cover: "opaque" });

    stage.frames(2);
    expect(dimOf(stage, sheet)?.visible).toBe(false);

    stage.level(sheet, 1, true);
    stage.frames(2);
    expect(stage.drawn.mock.api.sync.debug.overlays()[0]?.mode).toBe("cover");
    expect(dimOf(stage, sheet)?.visible).toBe(false);
  });

  it("leaves in the frame its overlay leaves", async () => {
    const stage = await stageOf();
    const shop = stage.overlay({ dim: 0.5 });

    stage.level(shop, 1);
    stage.frames(2);

    const dim = dimOf(stage, shop);

    stage.drawn.mock.world.ecs.despawn(shop);
    stage.frame();

    expect(dim?.destroyed).toBe(true);
    expect(stage.layer("ui").children).not.toContain(dim);
  });

  it("makes no dim object for an overlay with dim 0", async () => {
    const stage = await stageOf();
    const shop = stage.overlay({ dim: 0 });

    stage.level(shop, 1);
    stage.frames(2);

    expect(dimOf(stage, shop)).toBeUndefined();
    expect(stage.layer("ui").children.some(child => child.label.startsWith("overlay-dim"))).toBe(
      false
    );
  });

  it("clamps a dim above 1 to 1, with one dev warning", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const stage = await stageOf();
    const warn = vi.spyOn(stage.drawn.mock.log, "warn");
    const shop = stage.overlay({ dim: 3 });

    stage.level(shop, 1);
    stage.frames(3);

    expect(dimOf(stage, shop)?.alpha).toBe(1);
    expect(warn.mock.calls.filter(([code]) => code === "renderer:overlay-value")).toEqual([
      ["renderer:overlay-value", { entity: shop, field: "dim" }]
    ]);
  });
});
