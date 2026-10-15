import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { component, Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { HudPart, type OverlayValue } from "../../components";
import { endStage, type OverlayStage, startOverlayStage, UI_OWNER } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: the HUD parts an overlay keeps or lets fade (spec 22 O7): the factor follows the overlays' levels in the
// same frame (the atomicity checker compares every frame), all / none / a list, the top overlay decides, a part
// leaving takes no tap, a text part fades through a wrapper, parts outside the HUD layer are left alone.
// ---------------------------------------------------------------------------

const running: OverlayStage[] = [];

afterEach(() => {
  for (const stage of running.splice(0)) endStage(stage);
  vi.unstubAllGlobals();
});

/** A label a plugin above draws its own way. */
const Label = component("test.hudLabel", { text: "" });

/**
 * Starts a stage with two parts in the HUD layer, energy at (100, 100) and gems at (400, 100).
 *
 * @param options - The stage's options.
 * @returns The stage and the two parts.
 */
async function hudStage(options: Parameters<typeof startOverlayStage>[0] = {}) {
  const stage = await startOverlayStage(options);

  running.push(stage);

  const energy = stage.view({ layer: "hud", x: 100, y: 100, extra: [HudPart({ key: "energy" })] });
  const gems = stage.view({ layer: "hud", x: 400, y: 100, extra: [HudPart({ key: "gems" })] });

  stage.frames(2);

  return { stage, energy, gems };
}

/**
 * The alpha a part's top is drawn with.
 *
 * @param stage - The stage.
 * @param entity - The part.
 * @returns The alpha.
 */
function alphaOf(stage: OverlayStage, entity: Entity): number {
  return stage.topOf(entity).alpha;
}

describe("HUD parts", () => {
  it("keeps a part the overlay names at 1 and fades the others to 1 − level in the frame the level moves", async () => {
    const { stage, energy, gems } = await hudStage();
    const shop = stage.overlay({ dim: 0.5, hud: ["energy"] });

    stage.level(shop, 0.25);
    stage.frame();
    expect([alphaOf(stage, energy), alphaOf(stage, gems)]).toEqual([1, 0.75]);

    stage.level(shop, 1);
    stage.frame();
    expect([alphaOf(stage, energy), alphaOf(stage, gems)]).toEqual([1, 0]);
  });

  it.each<[OverlayValue["hud"], [number, number]]>([
    ["all", [1, 1]],
    ["none", [0, 0]],
    [["gems"], [0, 1]]
  ])("hud %j draws energy and gems at %j", async (hud, expected) => {
    const { stage, energy, gems } = await hudStage();
    const shop = stage.overlay({ hud });

    stage.level(shop, 1, true);
    stage.frames(2);

    expect([alphaOf(stage, energy), alphaOf(stage, gems)]).toEqual(expected);
  });

  it("lets the top overlay decide, blended by its level: a part the shop keeps fades with a sheet over it and comes back", async () => {
    const { stage, energy } = await hudStage();
    const shop = stage.overlay({ hud: ["energy"] }, { order: 1 });
    const settings = stage.overlay({ hud: "none" }, { order: 2 });

    stage.level(shop, 1, true);
    stage.level(settings, 0.5);
    stage.frame();
    expect(alphaOf(stage, energy)).toBe(0.5);

    stage.level(settings, 1);
    stage.frame();
    expect(alphaOf(stage, energy)).toBe(0);

    stage.drawn.mock.world.ecs.despawn(settings);
    stage.frame();
    expect(alphaOf(stage, energy)).toBe(1);
  });

  it("gives a part it does not keep no tap from the overlay's first frame, and taps again once it is fully back", async () => {
    const { stage, gems } = await hudStage();
    const sync = stage.drawn.mock.api.sync;
    const tap = (): Entity | undefined => sync.hitTest(450, 150, entity => entity === gems);

    expect(tap()).toBe(gems);

    const shop = stage.overlay({ hud: ["energy"] });

    stage.frame();
    expect(alphaOf(stage, gems)).toBe(1);
    expect(tap()).toBeUndefined();

    stage.level(shop, 1, true);
    stage.frame();
    stage.leave(shop);
    stage.level(shop, 0.01);
    stage.frame();
    expect(tap()).toBeUndefined();

    stage.drawn.mock.world.ecs.despawn(shop);
    stage.frame();
    expect(tap()).toBe(gems);
  });

  it("fades a text part through a wrapper while its adapter keeps writing its own alpha", async () => {
    const stage = await startOverlayStage();

    running.push(stage);

    const off = stage.drawn.mock.api.sync.displays.provide(Label, {
      create: () => {
        const text = new pixi.Graphics().rect(0, 0, 10, 10).fill(0xff_ff_ff);

        text.alpha = 0.8;

        return text;
      },
      update: () => true,
      destroy: object => (object as pixi.Container).destroy()
    });
    const label = stage.drawn.mock.world.ecs.spawn(UI_OWNER, [
      Label({ text: "12" }),
      Layer({ name: "hud" }),
      HudPart({ key: "gems" })
    ]);
    const shop = stage.overlay({ hud: "none" });

    stage.frames(2);
    stage.level(shop, 0.5);
    stage.frame();

    const object = stage.drawn.mock.ctx.state.sync.views.get(label)?.object;

    expect(stage.topOf(label)).not.toBe(object);
    expect(stage.topOf(label).alpha).toBe(0.5);
    expect(object?.alpha).toBe(0.8);
    off();
  });

  it("leaves a HudPart outside the HUD layer alone with one warning, and never fades a HUD view without HudPart", async () => {
    const stage = await startOverlayStage({ dev: true });

    running.push(stage);

    const warn = vi.spyOn(stage.drawn.mock.log, "warn");
    const stray = stage.view({ layer: "scene", extra: [HudPart({ key: "energy" })] });
    const plain = stage.view({ layer: "hud" });
    const shop = stage.overlay({ hud: "none" }, { order: 2 });

    stage.level(shop, 1, true);
    stage.frames(3);

    expect(alphaOf(stage, plain)).toBe(1);
    expect(stage.drawn.mock.ctx.state.sync.views.get(stray)?.hud).toBe(1);
    expect(warn.mock.calls.filter(([code]) => code === "renderer:hud-part-outside")).toEqual([
      ["renderer:hud-part-outside", { entity: stray, key: "energy" }]
    ]);
  });
});
