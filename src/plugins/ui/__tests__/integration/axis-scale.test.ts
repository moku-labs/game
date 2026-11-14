import { describe, expect, it } from "vitest";
import { read } from "../../../flow/doors/read";
import { Transform } from "../../../renderer/components";
import { entitiesSource } from "../../../world/inspect";
import { locateSource } from "../../inspect";
import { startUiApp } from "../app";

// ---------------------------------------------------------------------------
// Integration: game.locate of a view stretched on one axis (F179), on the real screen set in plain Bun with an inert
// renderer and real Yoga. The editor's picker and the agent read where the view is drawn, per axis.
// ---------------------------------------------------------------------------

describe("game.locate of a stretched view", () => {
  // Bug: locate scales the box by the uniform scale alone: the picker grabs a ribbon at its full width.
  it("answers half the width and the full height for scaleX 0.5 about the box's centre", async () => {
    const app = await startUiApp();
    const settings = app.ui.find("settings") ?? 0;
    const before = read(app, locateSource, { key: "settings" });

    app.world.ecs.set(settings, Transform, { scaleX: 0.5 });

    const after = read(app, locateSource, { key: "settings" });

    expect(before).toMatchObject({ w: 100, h: 100 });
    expect(after?.w).toBeCloseTo(50);
    expect(after?.h).toBeCloseTo(100);
    expect(after?.x).toBeCloseTo((before?.x ?? 0) + 25);
    expect(after?.y).toBeCloseTo(before?.y ?? 0);

    await app.stop();
  });
});

describe("the describe of a stretched view", () => {
  // Bug: a view's stretch is missing from what the describe lists, or every plain view gains `scaleX: 1` there and each
  // describe.json on disk changes.
  it("prints scaleX 0.5 for the stretched view and no factor key for a plain one", async () => {
    const app = await startUiApp();
    const settings = app.ui.find("settings") ?? 0;
    const transformOf = (entity: number): Record<string, unknown> | undefined =>
      read(app, entitiesSource, { component: "Transform" }).find(row => row.id === entity)
        ?.components.Transform as Record<string, unknown> | undefined;

    expect(Object.keys(transformOf(settings) ?? {})).not.toContain("scaleX");

    app.world.ecs.set(settings, Transform, { scaleX: 0.5 });

    expect(transformOf(settings)).toMatchObject({ scaleX: 0.5 });
    expect(Object.keys(transformOf(settings) ?? {})).not.toContain("scaleY");

    await app.stop();
  });
});
