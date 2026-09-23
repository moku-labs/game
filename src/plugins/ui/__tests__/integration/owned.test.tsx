import { describe, expect, it } from "vitest";
import { Pressed } from "../../../input/components";
import { Text } from "../../../text/components";
import { startUiApp } from "../app";

// ---------------------------------------------------------------------------
// A live patch leaves the owned fields of a component alone: a local write
// re-renders the whole HUD root, and a label whose string stood still keeps
// the `Text.resolved` the text plugin wrote for it, frame after frame.
// ---------------------------------------------------------------------------

describe("a live patch of a label", () => {
  it("keeps the resolved string of a plain-string label when its root re-renders", async () => {
    const app = await startUiApp();
    const coins = app.ui.find("coins") ?? 0;
    const which = app.ui.find("which") ?? 0;

    expect(app.world.ecs.get(coins, Text)?.resolved).toBe("7");

    app.input.tap(app.ui.find("video") ?? 0);

    const seen: string[] = [];

    for (let frame = 0; frame < 4; frame += 1) {
      app.time.step(16);
      seen.push(app.world.ecs.get(coins, Text)?.resolved ?? "missing");
    }

    expect(app.ui.find("coins")).toBe(coins);
    expect(seen).toEqual(["7", "7", "7", "7"]);
    expect(app.world.ecs.get(which, Text)?.resolved).toBe("video:3");

    await app.stop();
  });

  it("keeps the resolved string of a message label on every frame of a press", async () => {
    const app = await startUiApp();

    app.world.projection.mount(["hud", "rich"], { kind: "plugin", name: "test" });
    app.time.step(16);
    app.time.step(16);

    const auto = app.ui.find("auto") ?? 0;

    expect(app.world.ecs.get(auto, Text)?.resolved).toBe("coins 3");

    app.world.ecs.tag(app.ui.find("held") ?? 0, Pressed);

    const seen: string[] = [];

    for (let frame = 0; frame < 3; frame += 1) {
      app.time.step(16);
      seen.push(app.world.ecs.get(auto, Text)?.resolved ?? "missing");
    }

    expect(seen).toEqual(["coins 3", "coins 3", "coins 3"]);

    await app.stop();
  });

  it("keeps the other fields of the label in step with the markup", async () => {
    const app = await startUiApp();
    const which = app.ui.find("which") ?? 0;

    app.input.tap(app.ui.find("video") ?? 0);
    app.time.step(16);

    expect(app.world.ecs.get(which, Text)?.content).toBe("video:3");

    await app.stop();
  });
});
