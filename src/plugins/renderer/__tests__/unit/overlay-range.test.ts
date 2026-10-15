import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Exiting } from "../../../world/ecs/define";
import { HudPart, Overlay, OverlayLevel, Shape, Transform } from "../../components";
import { endStage, type OverlayStage, startOverlayStage, UI_OWNER } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: the range of an overlay (spec 22 O5.2, O5.4): every lower layer and the roots drawn before the overlay's
// root, its own dim and every picture left out; the others its picture hides; the overlays the step ignores. The
// renderer runs over real Pixi; the tree, picture and atomicity checkers watch every frame.
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
 * The range the step holds now.
 *
 * @param stage - The stage.
 * @returns Its entries and others, or `undefined`.
 */
function rangeOf(stage: OverlayStage) {
  return stage.drawn.mock.ctx.state.sync.overlay.active;
}

describe("overlay range", () => {
  it("is every lower layer and the roots drawn before the overlay's root, by depth then insertion", async () => {
    const stage = await stageOf();
    const board = stage.view({ layer: "scene" });
    const under = stage.view({ order: 1 });
    const sameBefore = stage.view({ order: 2 });
    const shop = stage.overlay({ dim: 0 }, { order: 2 });
    const sameAfter = stage.view({ order: 2 });
    const above = stage.view({ order: 3 });
    const hud = stage.view({ layer: "hud" });

    stage.frames(2);

    expect(rangeOf(stage)?.entries).toEqual([
      stage.layer("scene"),
      stage.topOf(under),
      stage.topOf(sameBefore)
    ]);
    expect(stage.layer("scene").renderable).toBe(false);
    expect(
      [under, sameBefore, shop, sameAfter, above, hud].map(entity => stage.topOf(entity).renderable)
    ).toEqual([false, false, true, true, true, true]);
    expect(stage.drawn.mock.api.sync.debug.overlays()).toMatchObject([
      { entity: shop, mode: "freeze", range: 3, kept: true }
    ]);
    expect(board).toBeGreaterThan(0);
  });

  it("leaves the overlay's own dim and its picture out of its range, and takes a lower overlay's dim in", async () => {
    const stage = await stageOf();
    const lower = stage.overlay({ dim: 0.4 }, { order: 1 });
    const upper = stage.overlay({ dim: 0.5 }, { order: 2 });

    stage.level(lower, 1);
    stage.level(upper, 0.5);
    stage.frames(2);

    const records = stage.drawn.mock.ctx.state.sync.overlay.records;
    const lowerDim = records.get(lower)?.dim;
    const upperDim = records.get(upper)?.dim;
    const picture = stage.drawn.mock.modules.kept.sprite(upper);
    const entries = rangeOf(stage)?.entries ?? [];

    expect(lowerDim).toBeDefined();
    expect(entries).toContain(lowerDim);
    expect(entries).toContain(stage.topOf(lower));
    expect(entries).not.toContain(upperDim);
    expect(entries).not.toContain(picture);
    expect(lowerDim?.renderable).toBe(false);
    expect(upperDim?.renderable).toBe(true);
  });

  it("hands others over: the layers above, the owner's dim and root, the roots above it; its layer container is neither", async () => {
    const stage = await stageOf();
    const under = stage.view({ order: 1 });
    const shop = stage.overlay({ dim: 0.5 }, { order: 2 });
    const above = stage.view({ order: 3 });

    stage.level(shop, 1);
    stage.frames(2);

    const range = rangeOf(stage);
    const dim = stage.drawn.mock.ctx.state.sync.overlay.records.get(shop)?.dim;

    expect(range?.others).toEqual(
      expect.arrayContaining([stage.layer("hud"), dim, stage.topOf(shop), stage.topOf(above)])
    );
    expect(range?.others).not.toContain(stage.layer("ui"));
    expect(range?.others).not.toContain(stage.topOf(under));
    expect(range?.entries).not.toContain(stage.layer("ui"));
  });

  it("is one render of the stage root, the entries drawn and every other node hidden for that call only", async () => {
    const stage = await stageOf();
    const under = stage.view({ order: 1 });
    const shop = stage.overlay({ dim: 0.5 }, { order: 2 });
    const above = stage.view({ order: 3 });
    const during: string[] = [];

    stage.drawn.stage.last().renderer.watchers.push(call => {
      if (call.target === undefined || call.container !== stage.root()) return;

      during.push(
        [under, shop, above]
          .map(entity => (stage.topOf(entity).renderable ? "drawn" : "hidden"))
          .join(",")
      );
    });

    const from = stage.mark();

    stage.level(shop, 1);
    stage.frames(2);

    expect(stage.rootRenders(from)).toHaveLength(1);
    expect(during).toEqual(["drawn,hidden,hidden"]);
    expect([under, shop, above].map(entity => stage.topOf(entity).renderable)).toEqual([
      false,
      true,
      true
    ]);
  });

  it("takes the quad of a kept root under the overlay in, hidden by its object mask, and leaves the owner's own quad out", async () => {
    const stage = await stageOf({ onDemand: false });
    const sync = stage.drawn.mock.api.sync;
    const under = stage.view({ order: 1 });
    const slot = { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" } as const;

    sync.filters.set(under, [slot]);
    stage.frames(4);

    const top = stage.topOf(under);
    const quad = top.parent?.children.find(child => child.label === `kept:${top.label}`);

    expect(quad?.visible).toBe(true);

    const shop = stage.overlay({ dim: 0.5 }, { order: 2 });

    sync.filters.set(shop, [{ ...slot, filter: new pixi.AlphaFilter() }]);
    stage.level(shop, 1);
    stage.frames(4);

    const entries = rangeOf(stage)?.entries ?? [];
    const shopTop = stage.topOf(shop);
    const shopQuad = shopTop.parent?.children.find(
      child => child.label === `kept:${shopTop.label}`
    );

    expect(entries).toContain(quad);
    expect(quad?.renderable).toBe(false);
    expect(stage.drawn.mock.ctx.state.sync.objectHidden.get(quad as never)).toBeGreaterThan(0);
    if (shopQuad !== undefined) expect(entries).not.toContain(shopQuad);
  });

  it("still hits a view under a kept picture: the hit test never reads renderable", async () => {
    const stage = await stageOf();
    const under = stage.view({ order: 1, x: 100, y: 100 });
    const shop = stage.overlay({ dim: 0.5 }, { order: 2, x: 900, y: 1800, w: 10, h: 10 });

    stage.level(shop, 1, true);
    stage.frames(2);

    expect(stage.topOf(under).renderable).toBe(false);
    expect(stage.drawn.mock.api.sync.hitTest(150, 150, entity => entity === under)).toBe(under);
  });

  it("ignores an overlay in the HUD layer, or above it, with one warning", async () => {
    const stage = await stageOf({ dev: true });
    const badge = stage.overlay({ dim: 0.5 }, { layer: "hud" });
    const warn = vi.spyOn(stage.drawn.mock.log, "warn");

    stage.frames(3);

    expect(rangeOf(stage)).toBeUndefined();
    expect(stage.drawn.mock.api.sync.debug.overlays()).toEqual([]);
    expect(warn.mock.calls.filter(([code]) => code === "renderer:overlay-above-hud")).toEqual([
      ["renderer:overlay-above-hud", { entity: badge, layer: "hud" }]
    ]);
  });

  it("ignores an Overlay on a view ui does not own, with one warning", async () => {
    const stage = await stageOf({ dev: true });
    const ecs = stage.drawn.mock.world.ecs;
    const foreign = ecs.spawn({ kind: "plugin", name: "board" }, [
      Transform({ x: 0 }),
      Shape({ w: 100, h: 100 }),
      Overlay({ dim: 0.5 }),
      OverlayLevel()
    ]);
    const warn = vi.spyOn(stage.drawn.mock.log, "warn");

    stage.frames(3);

    expect(rangeOf(stage)).toBeUndefined();
    expect(warn.mock.calls.filter(([code]) => code === "renderer:overlay-ignored")).toEqual([
      ["renderer:overlay-ignored", { entity: foreign, reason: "not a ui element" }]
    ]);
  });

  it("waits a frame for a root that has no view yet, and while the root hangs in no layer", async () => {
    const stage = await stageOf();
    const ecs = stage.drawn.mock.world.ecs;
    // A marked child whose root is an orphan: it names no layer, so nothing of it is drawn.
    const orphan = ecs.spawn(UI_OWNER, [Transform({ x: 0 }), Shape({ w: 10, h: 10 })]);
    const child = stage.view({ parent: orphan, extra: [Overlay({ dim: 0.5 }), OverlayLevel()] });

    stage.frames(2);

    expect(rangeOf(stage)).toBeUndefined();
    expect(stage.drawn.mock.ctx.state.sync.overlay.records.has(child)).toBe(false);

    // The marker before its view: the step finds it in the frame the view is built.
    const shop = stage.overlay({ dim: 0.5 });

    expect(stage.drawn.mock.ctx.state.sync.overlay.entities.has(shop)).toBe(true);
    stage.frame();

    expect(rangeOf(stage)?.owner).toBe(shop);
  });

  it("drops the range in the frame the overlay leaves the world, and draws the range live again", async () => {
    const stage = await stageOf();
    const under = stage.view({ order: 1 });
    const shop = stage.overlay({ dim: 0.5 }, { order: 2 });

    stage.level(shop, 1);
    stage.frames(2);
    expect(stage.topOf(under).renderable).toBe(false);

    stage.drawn.mock.world.ecs.despawn(shop);
    stage.frame();

    expect(rangeOf(stage)).toBeUndefined();
    expect(stage.topOf(under).renderable).toBe(true);
    expect(stage.layer("scene").renderable).toBe(true);
    expect(stage.drawn.mock.modules.kept.kept(shop)).toBe(false);
  });

  it("keeps a HUD part and an Exiting tag out of the way of the range", async () => {
    const stage = await stageOf();
    const part = stage.view({ layer: "hud", extra: [HudPart({ key: "energy" })] });
    const shop = stage.overlay({ dim: 0.5 }, { order: 2 });

    stage.level(shop, 1);
    stage.frames(2);
    stage.drawn.mock.world.ecs.tag(shop, Exiting);
    stage.frame();

    expect(stage.topOf(part).renderable).toBe(true);
    expect(stage.drawn.mock.api.sync.debug.overlays()[0]?.phase).toBe("exiting");
  });
});
