import { afterEach, describe, expect, it, vi } from "vitest";
import { endStage, type OverlayStage, startOverlayStage } from "../overlay-harness";

// ---------------------------------------------------------------------------
// Unit test: what the tools read of the overlays (spec 22 O10): `debug.overlays()` and the `overlay` event lines of
// an agent build, which the editor mirrors by the names `OverlayWhat` and `OverlayEventDetail`.
// ---------------------------------------------------------------------------

const running: OverlayStage[] = [];

afterEach(() => {
  for (const stage of running.splice(0)) endStage(stage);
  vi.unstubAllGlobals();
});

describe("overlay tools", () => {
  it("debug.overlays() reports phase, mode, level, range and kept of every overlay, bottom first", async () => {
    const stage = await startOverlayStage();

    running.push(stage);

    stage.view({ order: 1 });

    const shop = stage.overlay({ dim: 0.56 }, { order: 2 });
    const settings = stage.overlay({ dim: 0.4 }, { order: 3 });

    stage.level(shop, 1, true);
    stage.level(settings, 0.5);
    stage.frames(2);

    expect(stage.drawn.mock.api.sync.debug.overlays()).toEqual([
      {
        entity: shop,
        label: stage.drawn.mock.ctx.state.sync.views.get(shop)?.object.label,
        phase: "shown",
        mode: "live",
        level: 1,
        range: 0,
        kept: false
      },
      {
        entity: settings,
        label: stage.drawn.mock.ctx.state.sync.views.get(settings)?.object.label,
        phase: "entering",
        mode: "freeze",
        level: 0.5,
        range: 4,
        kept: true
      }
    ]);
  });

  it("writes the overlay event for open, landed, leave and gone in an agent build", async () => {
    const stage = await startOverlayStage({ agent: true });

    running.push(stage);

    const lines: unknown[] = [];
    const off = stage.drawn.mock.api.monitor.stream(line => {
      if (line.kind === "event" && line.name === "overlay") lines.push(line.detail);
    });
    const shop = stage.overlay({ dim: 0.56 });
    const label = (): string => stage.drawn.mock.ctx.state.sync.views.get(shop)?.object.label ?? "";

    stage.frame();
    const opened = label();

    stage.level(shop, 1, true);
    stage.frame();
    stage.leave(shop);
    stage.frame();
    stage.drawn.mock.world.ecs.despawn(shop);
    stage.frame();

    expect(lines).toEqual([
      { entity: shop, label: opened, what: "open", mode: "freeze" },
      { entity: shop, label: opened, what: "landed", mode: "freeze" },
      { entity: shop, label: opened, what: "leave", mode: "freeze" },
      { entity: shop, label: opened, what: "gone", mode: "freeze" }
    ]);
    off();
  });

  it("writes no event line outside an agent build", async () => {
    const stage = await startOverlayStage();

    running.push(stage);

    stage.overlay({ dim: 0.56 });
    stage.frames(2);

    expect(stage.drawn.mock.ctx.state.sync.overlay.events).toEqual([]);
    expect(stage.drawn.mock.api.sync.debug.overlays()).toHaveLength(1);
  });
});
