import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
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
