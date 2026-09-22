import { describe, expect, it } from "vitest";
import { Tappable } from "../../../input/components";
import { Box } from "../../components";
import { startUiApp, tick } from "../app";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock, flow, world, an inert
// renderer, input, anim, i18n, text and ui, in plain Bun with real Yoga. The
// HUD is a projection whose view returns JSX; every rect exists headless.
// ---------------------------------------------------------------------------

describe("ui plugin integration", () => {
  it("lays the HUD out into entities with rects", async () => {
    const app = await startUiApp();
    const tree = app.ui.tree();

    expect(tree.type).toBe("row");
    expect(tree.rect).toEqual({ x: 0, y: 0, w: 1080, h: 120 });
    expect(tree.children.map(child => child.key)).toEqual(["coins", "settings", "panel"]);
    expect(tree.children[0]?.rect.w).toBe(200);
    expect(tree.children[1]?.rect.x).toBe(210);

    await app.stop();
  });

  it("finds a keyed element and answers the gate through its intent", async () => {
    const app = await startUiApp();
    const settings = app.ui.find("settings");

    expect(settings).toBeDefined();
    expect(app.world.ecs.get(settings ?? 0, Tappable)?.intent).toBe("openSettings");
    expect(app.input.tap(settings ?? 0)).toBe(true);

    await app.stop();
  });

  it("writes the rect of every element into Box", async () => {
    const app = await startUiApp();
    const coins = app.ui.find("coins") ?? 0;

    expect(app.world.ecs.get(coins, Box)).toEqual({ x: 0, y: 0, w: 200, h: 60 });

    await app.stop();
  });

  it("answers the key of an element through the projection registry", async () => {
    const app = await startUiApp();

    expect(app.world.projection.entityOf("hud", "coins")).toBe(app.ui.find("coins"));

    await app.stop();
  });

  it("leaves no Yoga node and no ui entity behind on stop", async () => {
    const app = await startUiApp();

    await app.stop();
    await tick();

    expect(app.ui.tree().children).toEqual([]);
  });
});
