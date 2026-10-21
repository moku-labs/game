import { describe, expect, it } from "vitest";
import { Text } from "../../../text/components";
import { Box, UiCounters } from "../../components";
import { type BoxApp, CARD_WIDTH, startBoxApp } from "../box-app";

// ---------------------------------------------------------------------------
// Integration (F50): a text whose style has `wrap: "box"` wraps at the width
// the ui layout gave it. Real world, text and Yoga; plain Bun, no font loaded:
// a glyph is 19.2 wide and a line 38.4 high, rounded up to whole units by ui.
// The card row is 300 wide; its side is 100, so the cell that shrinks has 200.
// ---------------------------------------------------------------------------

/** One line of the 32 px style on the 0.6 em fallback. */
const LINE = 38.4;

/**
 * The height ui gives a text of so many lines: whole units, rounded up.
 *
 * @param lines - How many lines the text has.
 * @returns The height of its rect.
 */
function linesHigh(lines: number): number {
  return Math.ceil(lines * LINE - 0.0001);
}

/**
 * Mounts the card and runs its spawn frame: the reconcile, the solve, and the name resolved right
 * after the flush that attached it.
 *
 * @returns The running app.
 */
async function mountCard(): Promise<BoxApp> {
  const app = await startBoxApp();

  app.world.projection.mount(["cardScreen"], { kind: "plugin", name: "test" });
  app.time.step(16);

  return app;
}

/**
 * The rect of a keyed element, in root coordinates.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns Its `Box`.
 */
function rectOf(app: BoxApp, key: string) {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key) ?? 0;

  return app.world.ecs.get(entity, Box) ?? { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * The box `ui` wrote on the name's `Text`.
 *
 * @param app - The running app.
 * @returns `Text.box`.
 */
function boxOf(app: BoxApp): number | undefined {
  return app.world.ecs.get(app.ui.find("cardName") ?? 0, Text)?.box;
}

/**
 * Taps a button of the card and runs the frames of its re-render and its solve.
 *
 * @param app - The running app.
 * @param key - The key of the button.
 */
function tap(app: BoxApp, key: string): void {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  app.input.tap(app.ui.find(key) ?? 0);
  app.time.step(16);
  app.time.step(16);
}

describe('a text of a wrap "box" style in a row that shrinks it', () => {
  // The bug: the name is measured on one line, 441 wide: it runs out of its row, and the cell
  // grows by nothing.
  it("wraps at the room the side leaves, and the cell grows by the lines", async () => {
    const app = await mountCard();
    const name = rectOf(app, "cardName");
    const side = rectOf(app, "cardSide");

    expect(name.w).toBeLessThanOrEqual(CARD_WIDTH - side.w);
    expect(name.w).toBe(200);
    expect(name.h).toBe(linesHigh(3));
    expect(rectOf(app, "cardCell").h).toBe(name.h);
    expect(boxOf(app)).toBe(name.w);

    await app.stop();
  });

  // The bug: the remeasure of the frame after the spawn measures the name on one line, takes it
  // for a new size and solves the root again.
  it("asks for no second solve in the frame after its spawn", async () => {
    const app = await mountCard();
    const counters = app.world.ecs.resource(UiCounters);
    const solves = counters.solves;
    const measured = counters.measured;

    app.time.step(16);
    app.time.step(16);

    expect(counters.solves).toBe(solves);
    expect(counters.measured).toBe(measured);

    await app.stop();
  });

  // The bug: the name keeps the lines and the box of the room it had before.
  it("wraps again at the new room when the side widens, then rests", async () => {
    const app = await mountCard();

    tap(app, "widen");

    const counters = app.world.ecs.resource(UiCounters);
    const solves = counters.solves;
    const name = rectOf(app, "cardName");

    expect(name.w).toBe(CARD_WIDTH - 150);
    expect(name.h).toBe(linesHigh(4));
    expect(boxOf(app)).toBe(name.w);

    app.time.step(16);

    expect(counters.solves).toBe(solves);

    await app.stop();
  });

  // The bug: the name keeps the four lines of the narrower room after the side narrows back, or
  // the remeasure of its rewritten box keeps solving the root.
  it("wraps back at the room it had before when the side narrows again, then rests", async () => {
    const app = await mountCard();

    tap(app, "widen");
    tap(app, "narrow");
    app.time.step(16);

    const counters = app.world.ecs.resource(UiCounters);
    const solves = counters.solves;
    const name = rectOf(app, "cardName");

    expect(name.w).toBe(200);
    expect(name.h).toBe(linesHigh(3));
    expect(boxOf(app)).toBe(name.w);

    app.time.step(16);
    app.time.step(16);

    expect(counters.solves).toBe(solves);

    await app.stop();
  });

  it("stays on one line when the name fits the room", async () => {
    const app = await mountCard();

    tap(app, "shorten");

    const name = rectOf(app, "cardName");

    expect(name.w).toBe(77);
    expect(name.h).toBe(linesHigh(1));
    expect(boxOf(app)).toBe(name.w);

    await app.stop();
  });
});
