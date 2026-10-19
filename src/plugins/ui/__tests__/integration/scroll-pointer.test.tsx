import { afterEach, describe, expect, it, vi } from "vitest";
import { Pressed } from "../../../input/components";
import { ScrollState } from "../../components";
import { type DrawnApp, drag, press, settle, startDrawnApp } from "../drawn-app";

// ---------------------------------------------------------------------------
// Integration: a real finger on a scroll inside a scroll (change
// 2026-10-19-horizontal-scroll, S7 and the hand-off of input's G2). Pointer
// events on the fake canvas go through `input`'s hit test and gestures, so the
// press reaches the scroll `ui` gives `Scrollable` with its axis.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The entity of a keyed element, failing the test when it is not mounted.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity.
 */
function entityOf(app: DrawnApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  if (entity === undefined) throw new Error(`no element "${key}" on screen`);

  return entity;
}

/**
 * Starts the drawn app on the ward and mounts the shelf over it.
 *
 * @returns The app and its Pixi.
 */
async function startShelf() {
  const started = await startDrawnApp();

  started.app.world.projection.mount(["drawn.shelf"], { kind: "plugin", name: "test" });
  await settle(started.app, 3);

  return started;
}

describe("a finger on a shelf inside a page", () => {
  it("pans the shelf to its end from a press on its button, leaves the page, and buys nothing", async () => {
    // Bug caught: the press stays on the button, so the shelf never follows and the release buys;
    // or the shelf at its end passes the rest of the move to the page.
    const { app, pixi } = await startShelf();
    const shelf = entityOf(app, "shelf");
    const page = entityOf(app, "shelfPage");

    await drag(app, pixi, { x: 150, y: 200 }, { x: -1500, y: 220 });
    await settle(app, 60);

    expect(app.world.ecs.get(shelf, ScrollState)).toEqual({ offset: 600, max: 600, moving: false });
    expect(app.world.ecs.get(page, ScrollState)).toEqual({ offset: 0, max: 600, moving: false });
    expect(app.world.ecs.has(page, Pressed)).toBe(false);
    expect(app.ui.find("shopPanel")).toBeUndefined();

    await app.stop();
  });

  it("still taps the button when the finger lifts where it landed", async () => {
    // Bug caught: the shelf, drawn over its own content, takes every press on its tiles.
    const { app, pixi } = await startShelf();

    await press(app, pixi, { x: 150, y: 200 });
    await settle(app, 3);

    expect(app.ui.find("shopPanel")).toBeDefined();
    expect(app.world.ecs.get(entityOf(app, "shelf"), ScrollState)?.offset).toBe(0);

    await app.stop();
  });
});
