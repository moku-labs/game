import { describe, expect, it } from "vitest";
import { Pressed } from "../../../input/components";
import { Shape } from "../../../renderer/components";
import { createPerfApp, settlePerfApp, views } from "../perf/app";

// ---------------------------------------------------------------------------
// Integration: a pointer flag restyles its element only (change
// 2026-10-18-cheap-idle-tick, U3). The board is one component of 200 elements
// whose view counts its runs; a press and a release land as `input` lands them,
// through the `Pressed` tag. Real flow, world, text and Yoga; inert renderer.
// ---------------------------------------------------------------------------

describe("a press on a button of a 200-element component", () => {
  it("restyles the button down and up, and runs no view of its root", async () => {
    const app = createPerfApp();

    await app.start();
    await settlePerfApp(app);

    const hot = app.ui.find("hot") ?? -1;
    const runs = views.board;

    app.world.ecs.tag(hot, Pressed);
    app.time.step(16);

    expect(app.world.ecs.get(hot, Shape)?.fill).toBe(0x11_22_33);

    app.world.ecs.untag(hot, Pressed);
    app.time.step(16);
    app.time.step(16);

    expect(app.world.ecs.get(hot, Shape)?.fill).toBe(0x33_44_55);
    expect(views.board).toBe(runs);

    await app.stop();
  });
});
