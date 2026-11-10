import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { HudPart, Overlay } from "../../components";
import type { PixiRenderLayer } from "../../types";
import { endStage, type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: `Overlay({ hud: "under" })` (change 2026-11-04-f141-f147-f148-ui-text, F147 U1–U6): the HUD layer is drawn
// under the overlay's own dim through one Pixi `RenderLayer` placed right before the dim. The renderer runs over real
// Pixi (its real `RenderLayer`); the tree, picture and atomicity checkers watch every frame.
// ---------------------------------------------------------------------------

const running: OverlayStage[] = [];

afterEach(() => {
  for (const stage of running.splice(0)) endStage(stage);
  vi.unstubAllGlobals();
});

/**
 * Starts a stage the test ends in `afterEach`, with a part of the HUD at (100, 100), 100 by 100.
 *
 * @param options - The stage's options.
 * @returns The stage and the HUD part.
 */
async function hudStage(options: Parameters<typeof startOverlayStage>[0] = {}) {
  const stage = await startOverlayStage(options);

  running.push(stage);

  const energy = stage.view({ layer: "hud", x: 100, y: 100, extra: [HudPart({ key: "energy" })] });

  stage.view({ layer: "scene" });
  stage.frames(2);

  return { stage, energy };
}

/**
 * The HUD render layer of an overlay.
 *
 * @param stage - The stage.
 * @param entity - The overlay.
 * @returns Its render layer, or `undefined`.
 */
function underOf(stage: OverlayStage, entity: Entity): PixiRenderLayer | undefined {
  return stage.drawn.mock.ctx.state.sync.overlay.records.get(entity)?.under;
}

/**
 * The render layer the HUD layer container is drawn from now.
 *
 * @param stage - The stage.
 * @returns It, or `null` while the HUD draws in its own place.
 */
function holderOfHud(stage: OverlayStage): unknown {
  return stage.layer("hud").parentRenderLayer;
}

describe('Overlay({ hud: "under" })', () => {
  // Bug: no render layer, or one placed anywhere but right under the dim, draws the HUD above the dim or above the
  // overlay's root; a picture placed after it covers the HUD.
  it("draws the HUD layer in one render layer right before the dim, at its depth, with the picture right before it (U1)", async () => {
    const { stage } = await hudStage();
    const pyramid = stage.overlay({ dim: 0.82, dimColor: 0x1e_16_1a, hud: "under" }, { order: 2 });

    stage.level(pyramid, 1, true);
    stage.frames(2);

    const ui = stage.layer("ui");
    const record = stage.drawn.mock.ctx.state.sync.overlay.records.get(pyramid);
    const under = record?.under;
    const dim = record?.dim;

    if (under === undefined || dim === undefined) throw new Error("no render layer or no dim");

    expect(ui.children[ui.getChildIndex(dim) - 1]).toBe(under);
    expect(under.zIndex).toBe(dim.zIndex);
    expect(ui.children[ui.getChildIndex(under) - 1]).toBe(
      stage.drawn.mock.modules.kept.sprite(pyramid)
    );
    expect(holderOfHud(stage)).toBe(under);

    stage.frames(3);
    expect(underOf(stage, pyramid)).toBe(under);
  });

  // Bug: the HUD dims with the overlay before it is there (level 0), or the attach frame is not drawn on demand, so the
  // HUD stays bright above the dim until something else draws.
  it("takes the HUD from the first frame its level is above 0, and that frame is drawn", async () => {
    const { stage } = await hudStage();
    const pyramid = stage.overlay({ dim: 0.82, hud: "under" }, { order: 2 });

    stage.frames(2);
    expect(holderOfHud(stage)).toBeNull();
    stage.frames(3);

    stage.level(pyramid, 0.25);

    expect(stage.frame()).toBe(true);
    expect(holderOfHud(stage)).toBe(underOf(stage, pyramid));
  });

  // Bug: the holder stays the first overlay that took the HUD, so a second "under" sheet draws the HUD under the lower
  // dim only, or a holder that leaves keeps it.
  it("is held by the topmost overlay with hud under, and passes to the one below when it leaves (U2)", async () => {
    const { stage } = await hudStage();
    const lower = stage.overlay({ dim: 0.5, hud: "under" }, { order: 1 });
    const upper = stage.overlay({ dim: 0.5, hud: "under" }, { order: 2 });

    stage.level(lower, 1, true);
    stage.level(upper, 1, true);
    stage.frames(2);
    expect(holderOfHud(stage)).toBe(underOf(stage, upper));
    expect(underOf(stage, lower)?.renderLayerChildren).toEqual([]);

    stage.drawn.mock.world.ecs.despawn(upper);

    expect(stage.frame()).toBe(true);
    expect(holderOfHud(stage)).toBe(underOf(stage, lower));
  });

  // Bug: the HUD stays under the veil after the overlay is gone (dimmed, no taps), or after it says "all" again.
  it("gives the HUD back to its own place when the level reaches 0, and when hud is no longer under (U2)", async () => {
    const { stage } = await hudStage();
    const pyramid = stage.overlay({ dim: 0.82, hud: "under" }, { order: 2 });

    stage.level(pyramid, 1, true);
    stage.frames(2);
    expect(holderOfHud(stage)).toBe(underOf(stage, pyramid));

    stage.leave(pyramid);
    stage.level(pyramid, 0);

    expect(stage.frame()).toBe(true);
    expect(holderOfHud(stage)).toBeNull();
    expect(underOf(stage, pyramid)?.renderLayerChildren).toEqual([]);

    const shop = stage.overlay({ dim: 0.5, hud: "under" }, { order: 3 });

    stage.level(shop, 1, true);
    stage.frames(2);
    expect(holderOfHud(stage)).toBe(underOf(stage, shop));

    stage.drawn.mock.world.ecs.set(shop, Overlay, { hud: "all" });

    expect(stage.frame()).toBe(true);
    expect(holderOfHud(stage)).toBeNull();
  });

  // Bug: a sheet without "under" opened over a "under" one leaves the HUD under the lower dim, inside the upper
  // picture, which covers it: the HUD is gone from the screen while the sheet stands.
  it("lets the HUD draw in its own place while an overlay above the holder keeps the range, and takes it back after", async () => {
    const { stage } = await hudStage();
    const pyramid = stage.overlay({ dim: 0.82, hud: "under" }, { order: 1 });

    stage.level(pyramid, 1, true);
    stage.frames(2);
    expect(holderOfHud(stage)).toBe(underOf(stage, pyramid));

    // Its first frame, at level 0, it owns the range already: its picture holds the pyramid and its dim.
    const confirm = stage.overlay({ dim: 0.4 }, { order: 2 });

    expect(stage.frame()).toBe(true);
    expect(stage.drawn.mock.api.sync.debug.overlays().at(-1)).toMatchObject({
      entity: confirm,
      mode: "freeze"
    });
    expect(holderOfHud(stage)).toBeNull();

    stage.level(confirm, 0.5);
    stage.frame();
    expect(holderOfHud(stage)).toBeNull();

    stage.drawn.mock.world.ecs.despawn(confirm);
    stage.frame();
    expect(holderOfHud(stage)).toBe(underOf(stage, pyramid));
  });

  // Bug: the HUD layer container hung elsewhere for a while (Pixi lets go of its render layer when it leaves its parent)
  // comes back and stays drawn above the veil; or it is held while it hangs outside the stage root, in another render
  // group, where a render layer cannot draw it.
  it("holds the HUD only while it hangs in the stage root, and takes it again when it comes back (U2)", async () => {
    const { stage } = await hudStage();
    const pyramid = stage.overlay({ dim: 0.82, hud: "under" }, { order: 2 });
    const hud = stage.layer("hud");
    const root = stage.root();
    const aside = new pixi.Container();

    stage.level(pyramid, 1, true);
    stage.frames(2);
    expect(holderOfHud(stage)).toBe(underOf(stage, pyramid));

    // Taken out and hung back between two frames: Pixi let go of the link, the step finds it gone.
    aside.addChild(hud);
    root.addChild(hud);
    expect(holderOfHud(stage)).toBeNull();
    expect(stage.frame()).toBe(true);
    expect(holderOfHud(stage)).toBe(underOf(stage, pyramid));

    aside.addChild(hud);
    stage.frame();
    expect(holderOfHud(stage)).toBeNull();
    expect(underOf(stage, pyramid)?.renderLayerChildren).toEqual([]);

    root.addChild(hud);

    expect(stage.frame()).toBe(true);
    expect(holderOfHud(stage)).toBe(underOf(stage, pyramid));
    aside.destroy();
  });

  // Bug: a HUD view under the veil still takes the tap (the HUD layer is walked first, above every overlay), so a tap
  // on the dimmed HUD reaches it through the sheet; a HUD view without HudPart too.
  it("takes no tap on the HUD while it is held under the veil, a view without HudPart included, and taps again after (U4)", async () => {
    const { stage, energy } = await hudStage();
    const plain = stage.view({ layer: "hud", x: 400, y: 100 });

    stage.frames(2);

    const sync = stage.drawn.mock.api.sync;
    const tap = (x: number, entity: Entity): Entity | undefined =>
      sync.hitTest(x, 150, hit => hit === entity);

    expect([tap(150, energy), tap(450, plain)]).toEqual([energy, plain]);

    const pyramid = stage.overlay({ dim: 0.82, hud: "under" }, { order: 2 });

    stage.level(pyramid, 0.5);
    stage.frame();
    expect([tap(150, energy), tap(450, plain)]).toEqual([undefined, undefined]);

    stage.drawn.mock.world.ecs.despawn(pyramid);
    stage.frame();
    expect([tap(150, energy), tap(450, plain)]).toEqual([energy, plain]);
  });

  // Bug: the render layer counted as an entry is hidden by "freeze" and lifted into the picture, which then draws the
  // HUD it holds, frozen; or the HUD container is not hidden for the picture's render.
  it("never makes the render layer an entry of the range: it stays among the others with the HUD, both hidden for the picture (U3)", async () => {
    const { stage } = await hudStage();
    const under = stage.view({ order: 1 });
    const pyramid = stage.overlay({ dim: 0.82, hud: "under" }, { order: 2 });
    const hud = stage.layer("hud");
    const during: boolean[] = [];

    stage.drawn.stage.last().renderer.watchers.push(call => {
      if (call.target === undefined || call.container !== stage.root()) return;

      during.push(hud.renderable && hud.visible);
    });
    stage.level(pyramid, 1, true);
    stage.frames(2);

    const range = stage.drawn.mock.ctx.state.sync.overlay.active;
    const layer = underOf(stage, pyramid);

    expect(range?.entries).toEqual([stage.layer("scene"), stage.topOf(under)]);
    expect(range?.others).toEqual(expect.arrayContaining([hud, layer]));
    expect(during).toEqual([false]);
    expect(holderOfHud(stage)).toBe(layer);
  });

  // Bug: a dropped overlay leaves the HUD container attached to a destroyed render layer: Pixi then draws the HUD
  // nowhere, neither in its place nor in the layer.
  it("destroys the render layer with its overlay and leaves nothing attached (U5)", async () => {
    const { stage } = await hudStage();
    const pyramid = stage.overlay({ dim: 0.82, hud: "under" }, { order: 2 });

    stage.level(pyramid, 1, true);
    stage.frames(2);

    const under = underOf(stage, pyramid);

    stage.drawn.mock.world.ecs.despawn(pyramid);

    expect(stage.frame()).toBe(true);
    expect(under?.destroyed).toBe(true);
    expect(stage.layer("ui").children).not.toContain(under);
    expect(holderOfHud(stage)).toBeNull();
  });

  // Bug: a restore or new layers keep the old render layer (in a dropped container, or of the old tree) holding the
  // HUD, or a layer that holds nothing new: the HUD draws nowhere, or not under the dim.
  it("makes the render layer again after new layers and after a restore, the HUD held by the new one only (U5)", async () => {
    const { stage } = await hudStage();
    const pyramid = stage.overlay({ dim: 0.82, hud: "under" }, { order: 2 });

    stage.level(pyramid, 1, true);
    stage.frames(2);

    const first = underOf(stage, pyramid);

    stage.drawn.mock.world.projection.setLayers([
      { name: "back", sort: "none" },
      { name: "scene", sort: "none" },
      { name: "ui", sort: "order" },
      { name: "hud", sort: "none", above: "overlays" }
    ]);
    stage.frame();

    const second = underOf(stage, pyramid);

    expect(first?.destroyed).toBe(true);
    expect(second).not.toBe(first);
    expect(first?.renderLayerChildren).toEqual([]);
    expect(holderOfHud(stage)).toBe(second);

    stage.drawn.mock.modules.sync.rebuildAll();
    stage.frame();

    const third = underOf(stage, pyramid);

    expect(second?.destroyed).toBe(true);
    expect(second?.renderLayerChildren).toEqual([]);
    expect(third?.destroyed).toBe(false);
    expect(holderOfHud(stage)).toBe(third);
  });

  // Bug: "under" with no dim makes a layer anyway and takes the HUD under nothing, or keeps it once the dim is written
  // to 0: the HUD drops under the overlay's root and loses its taps for no veil.
  it("makes no render layer for a dim of 0, and lets the HUD go when the dim is written to 0: as with all (U6)", async () => {
    const { stage, energy } = await hudStage();
    const clear = stage.overlay({ dim: 0, hud: "under" }, { order: 2 });

    stage.level(clear, 1, true);
    stage.frames(2);

    expect(underOf(stage, clear)).toBeUndefined();
    expect(holderOfHud(stage)).toBeNull();
    expect(stage.drawn.mock.api.sync.hitTest(150, 150, hit => hit === energy)).toBe(energy);

    const pyramid = stage.overlay({ dim: 0.82, hud: "under" }, { order: 3 });

    stage.level(pyramid, 1, true);
    stage.frames(2);
    expect(holderOfHud(stage)).toBe(underOf(stage, pyramid));

    stage.drawn.mock.world.ecs.set(pyramid, Overlay, { dim: 0 });
    stage.frame();
    expect(holderOfHud(stage)).toBeNull();
  });

  // Bug: the clamp reads "under" as an unknown value (warned, drawn as "all"), or no longer warns for a wrong one.
  it("keeps hud under through the clamp without a warning, and still reads a wrong hud as all with one warning", async () => {
    const { stage } = await hudStage({ dev: true });
    const warn = vi.spyOn(stage.drawn.mock.log, "warn");
    const pyramid = stage.overlay({ dim: 0.82, hud: "under" }, { order: 2 });
    const wrong = stage.overlay(
      { dim: 0.5, hud: "below" as unknown as "under" },
      { layer: "scene", order: 9 }
    );

    stage.level(pyramid, 1, true);
    stage.level(wrong, 1, true);
    stage.frames(2);

    const records = stage.drawn.mock.ctx.state.sync.overlay.records;

    expect(records.get(pyramid)?.value.hud).toBe("under");
    expect(records.get(wrong)?.value.hud).toBe("all");
    expect(warn.mock.calls.filter(([code]) => code === "renderer:overlay-value")).toEqual([
      ["renderer:overlay-value", { entity: wrong, field: "hud" }]
    ]);
  });

  // Bug: no warning for a switch that does nothing, or one every frame, or one in a build that is not dev.
  it("warns once per overlay for hudInert with hud none or under, and not outside dev", async () => {
    const { stage } = await hudStage({ dev: true });
    const warn = vi.spyOn(stage.drawn.mock.log, "warn");
    const pyramid = stage.overlay({ dim: 0.82, hud: "under", hudInert: true }, { order: 2 });
    const quiet = stage.overlay({ dim: 0.5, hud: "none", hudInert: true }, { order: 3 });
    const kept = stage.overlay({ dim: 0.5, hud: ["energy"], hudInert: true }, { order: 4 });

    stage.level(pyramid, 1, true);
    stage.level(quiet, 1, true);
    stage.level(kept, 1, true);
    stage.frames(3);

    const unused = (): unknown[] =>
      warn.mock.calls.filter(([code]) => code === "renderer:hud-inert-unused");

    expect(unused()).toEqual([
      ["renderer:hud-inert-unused", { entity: pyramid, hud: "under" }],
      ["renderer:hud-inert-unused", { entity: quiet, hud: "none" }]
    ]);
    // The value is kept: it has no effect, the clamp does not rewrite it.
    expect(stage.drawn.mock.ctx.state.sync.overlay.records.get(pyramid)?.value.hudInert).toBe(true);
  });

  it("logs no hud-inert-unused outside a dev build", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", false);

    const { stage } = await hudStage();
    const warn = vi.spyOn(stage.drawn.mock.log, "warn");
    const quiet = stage.overlay({ dim: 0.5, hud: "none", hudInert: true }, { order: 3 });

    stage.level(quiet, 1, true);
    stage.frames(3);

    expect(warn.mock.calls.filter(([code]) => code === "renderer:hud-inert-unused")).toEqual([]);
  });
});
