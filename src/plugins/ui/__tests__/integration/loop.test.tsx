import { afterEach, describe, expect, it, vi } from "vitest";
import { Transform } from "../../../renderer/components";
import { type CauseApp, frames, PEAK, startCauseApp } from "../cause-app";
import { type StackApp, startStackApp } from "../stack-app";

// ---------------------------------------------------------------------------
// Delta 6, B6 in ui: the `loop` hook of an element's motion starts when the
// element enters, and a new motion prop swaps it. A card that turns ready
// sways wider; a motion without a loop stops it.
// ---------------------------------------------------------------------------

/**
 * Mounts the swaying card and gives it its frames.
 *
 * @returns The running app with the card on screen.
 */
async function mountCard(): Promise<StackApp> {
  const app = await startStackApp();

  app.world.projection.mount(["swayScreen"], { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);
  app.time.step(16);

  return app;
}

/**
 * Steps one whole cycle of the sway and reads the widest turn of the card on the way.
 *
 * @param app - The running app.
 * @returns The largest rotation the card reached.
 */
function widestTurn(app: StackApp): number {
  const card = app.ui.find("card") ?? 0;
  let widest = 0;

  for (let frame = 0; frame < 70; frame += 1) {
    app.time.step(16);
    widest = Math.max(widest, app.world.ecs.get(card, Transform)?.rotation ?? 0);
  }

  return widest;
}

/**
 * Taps a local-state button of the card and lets the card render again.
 *
 * @param app - The running app.
 * @param key - The key of the button.
 */
function tapLocal(app: StackApp, key: string): void {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  app.input.tap(app.ui.find(key) ?? 0);
  app.time.step(16);
  app.time.step(16);
}

describe("the loop of an element's motion", () => {
  it("starts when the element enters and runs outside its exit handles", async () => {
    const app = await mountCard();

    expect(app.anim.active()).toBe(1);
    expect(widestTurn(app)).toBeCloseTo(0.1, 1);
    expect(app.anim.active()).toBe(1);

    await app.stop();
  });

  it("is swapped when the motion prop changes: one loop, the wider sway", async () => {
    const app = await mountCard();

    tapLocal(app, "toWide");

    expect(app.anim.active()).toBe(1);
    expect(widestTurn(app)).toBeCloseTo(0.3, 1);

    await app.stop();
  });

  it("stops when the motion prop goes, and the card stands at rest", async () => {
    const app = await mountCard();

    widestTurn(app);
    app.time.step(100);
    tapLocal(app, "toStill");

    const card = app.ui.find("card") ?? 0;

    expect(app.anim.active()).toBe(0);
    expect(app.world.ecs.get(card, Transform)?.rotation).toBe(0);
    expect(widestTurn(app)).toBe(0);

    await app.stop();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Mounts the card whose motion is built in its view body, and steps to the middle of the first
 * swing of its loop.
 *
 * @returns The running app, the card near the peak of its sway.
 */
async function mountRebuilt(): Promise<CauseApp> {
  const app = await startCauseApp();

  app.world.projection.mount(["rebuilt.screen"], { kind: "plugin", name: "test" });
  frames(app, 11);

  return app;
}

/**
 * Taps a local-state button of the rebuilt card, so its view runs again, and steps one frame.
 *
 * @param app - The running app.
 * @param key - The key of the button.
 * @returns The rotation of the card after that frame.
 */
function renderAgain(app: CauseApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  app.input.tap(app.ui.find(key) ?? 0);
  app.time.step(16);

  return app.world.ecs.get(app.ui.find("rebuiltCard") ?? 0, Transform)?.rotation ?? 0;
}

/**
 * The `ui:motion-rebuilt` lines the log kept.
 *
 * @param app - The running app.
 * @returns Their payloads.
 */
function rebuiltWarnings(app: CauseApp): unknown[] {
  return app.log
    .trace()
    .filter(entry => entry.event === "ui:motion-rebuilt")
    .map(entry => entry.data);
}

describe("a loop built again at every render (spec 16 U5, F7)", () => {
  // Bug (F7): a `defineMotion` written in the view body is a new loop at every render, and the
  // sway jumps back to its start each time the screen renders.
  it("keeps running a loop rebuilt with the same data across three renders", async () => {
    const app = await mountRebuilt();
    const turns = [
      renderAgain(app, "again1"),
      renderAgain(app, "again2"),
      renderAgain(app, "again3")
    ];

    expect(turns.every(turn => turn > PEAK / 2)).toBe(true);

    await app.stop();
  });

  it("restarts it for the same motion with another loop length", async () => {
    const app = await mountRebuilt();

    expect(renderAgain(app, "slower")).toBeLessThan(PEAK / 4);

    await app.stop();
  });

  it("restarts it for a hand-written loop of a new reference", async () => {
    const app = await mountRebuilt();

    expect(renderAgain(app, "byHand")).toBeLessThan(PEAK / 4);

    await app.stop();
  });

  it("names a loop rebuilt by three renders once, in a dev build", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const app = await mountRebuilt();

    for (const key of ["again1", "again2", "again3", "again1", "again2"]) renderAgain(app, key);

    expect(rebuiltWarnings(app)).toEqual([{ key: "rebuiltCard", fingerprinted: true }]);

    await app.stop();
  });

  it("names nothing in a production build", async () => {
    const app = await mountRebuilt();

    for (const key of ["again1", "again2", "again3"]) renderAgain(app, key);

    expect(rebuiltWarnings(app)).toEqual([]);

    await app.stop();
  });
});
