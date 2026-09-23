import { describe, expect, it, vi } from "vitest";
import { read } from "../../../flow/doors/read";
import type { ViewportSize } from "../../../renderer/viewport/types";
import { Box } from "../../components";
import { rectSource, uiSource } from "../../inspect";
import { fitBars, startUiApp } from "../app";

// ---------------------------------------------------------------------------
// Integration: the ui sources of the /inspect door on the real screen set, in
// plain Bun with an inert renderer and real Yoga
// ---------------------------------------------------------------------------

/** An iPhone SE (375 x 667 CSS px) in reference units: too short for the 970 u board. */
const SE: ViewportSize = {
  width: 1080,
  height: (667 * 1080) / 375,
  scale: 375 / 1080,
  orientation: "portrait",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
};

/** The natural rect of the fixture's cell inside the board: left 100, top 100, 140 u square. */
const CELL = { left: 100, top: 100, side: 140 } as const;

/** The app the tests drive. */
type App = Awaited<ReturnType<typeof startUiApp>>;

/**
 * Mounts the fitted board on an SE and gives it a frame, so the board is drawn below 1.
 *
 * @param app - What `startUiApp` returned.
 */
function fitOnSe(app: App): void {
  app.world.projection.mount(["hud", "fitted"], { kind: "plugin", name: "test" });
  app.time.step(16);
  vi.spyOn(app.renderer.viewport, "size").mockReturnValue(SE);
  app.time.step(16);
}

/**
 * The board's fit and natural rect, from the slot the layout solved.
 *
 * @param app - The app with the fitted board on an SE.
 * @returns The fit scale and the board's natural rect.
 */
function boardOf(app: App): { fit: number; x: number; y: number } {
  const slotEntity = app.ui.find("slot") ?? 0;
  const slot = app.world.ecs.get(slotEntity, Box) ?? { x: 0, y: 0, w: 0, h: 0 };
  const content = {
    x: slot.x + fitBars.padding,
    y: slot.y + fitBars.padding,
    w: slot.w - 2 * fitBars.padding,
    h: slot.h - 2 * fitBars.padding
  };

  return {
    fit: Math.min(1, content.w / 970, content.h / 970),
    x: content.x + (content.w - 970) / 2,
    y: content.y + (content.h - 970) / 2
  };
}

describe("game.rect on the real ui", () => {
  it("places a cell of the fitted board on an SE where it is drawn, in reference units headless", async () => {
    const app = await startUiApp();

    fitOnSe(app);

    const board = boardOf(app);
    const centre = { x: board.x + 970 / 2, y: board.y + 970 / 2 };
    const rect = read(app, rectSource, { key: "cell" });

    expect(board.fit).toBeLessThan(1);
    expect(rect?.x).toBeCloseTo(centre.x + board.fit * (board.x + CELL.left - centre.x), 5);
    expect(rect?.y).toBeCloseTo(centre.y + board.fit * (board.y + CELL.top - centre.y), 5);
    expect(rect?.w).toBeCloseTo(CELL.side * board.fit, 5);
    expect(rect?.h).toBeCloseTo(CELL.side * board.fit, 5);

    await app.stop();
  });

  it("maps the rect through the viewport to CSS px of the page", async () => {
    const app = await startUiApp();

    fitOnSe(app);

    const inReference = read(app, rectSource, { key: "cell" });

    vi.spyOn(app.renderer.viewport, "toScreen").mockImplementation(point => ({
      x: 10 + point.x * SE.scale,
      y: 20 + point.y * SE.scale
    }));

    const onPage = read(app, rectSource, { key: "cell" });

    expect(onPage?.x).toBeCloseTo(10 + (inReference?.x ?? 0) * SE.scale, 5);
    expect(onPage?.y).toBeCloseTo(20 + (inReference?.y ?? 0) * SE.scale, 5);
    expect(onPage?.w).toBeCloseTo((inReference?.w ?? 0) * SE.scale, 5);
    expect(onPage?.h).toBeCloseTo((inReference?.h ?? 0) * SE.scale, 5);

    await app.stop();
  });

  it("gives a bare button with no fill its layout box", async () => {
    const app = await startUiApp();
    const settings = app.world.ecs.get(app.ui.find("settings") ?? 0, Box);

    expect(read(app, rectSource, { key: "settings" })).toEqual(settings);
    expect(read(app, rectSource, { key: "settings" })).toMatchObject({ w: 100, h: 100 });

    await app.stop();
  });

  it("answers undefined for a key that is not on screen", async () => {
    const app = await startUiApp();

    expect(read(app, rectSource, { key: "cell" })).toBeUndefined();

    await app.stop();
  });
});

describe("game.ui on the real ui", () => {
  it("reads the tree ui.tree() answers, and changes nothing", async () => {
    const app = await startUiApp();
    const model = app.model.store.snapshot();
    const world = app.world.ecs.snapshot();

    expect(read(app, uiSource)).toEqual(app.ui.tree());
    expect(app.model.store.snapshot()).toBe(model);
    expect(app.world.ecs.snapshot()).toEqual(world);

    await app.stop();
  });
});
