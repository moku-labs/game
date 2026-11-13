import { afterEach, describe, expect, it, vi } from "vitest";
import { Pressed } from "../../../input/components";
import { ScrollState } from "../../components";
import {
  type DrawnApp,
  type DrawnPixi,
  type DrawnPoint,
  drag,
  type LockTold,
  lockStart,
  pointer,
  press,
  renderLock,
  settle,
  startDrawnApp,
  step
} from "../drawn-app";

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

// ---------------------------------------------------------------------------
// Integration: `locked` on `scroll` (F177, change 2026-11-13-f177-scroll-lock),
// L1–L11. The lock strip of the drawn fixture: an x scroll of 306 u over a
// 696 u track of six cards that answer `shop`, stops 0, 318 and 390, at
// (0, 100); card n spans x 116 × n − offset to 116 × (n + 1) − offset, y 100
// to 220, and the strip's own background lies below them, y 220 to 300.
// ---------------------------------------------------------------------------

/** A point on the first card at offset 0, on the fourth at offsets 288 to 404. */
const ON_CARD = { x: 60, y: 160 };

/** A point on the third card at offset 0. */
const ON_THIRD = { x: 250, y: 160 };

/** A point on the strip's own background, below the cards. */
const ON_BACKGROUND = { x: 150, y: 260 };

/** The lock app of the running test, stopped after it. */
let locking: DrawnApp | undefined;

afterEach(async () => {
  await locking?.stop();
  locking = undefined;
  lockStart.told = {};
});

/**
 * Starts the drawn app, mounts the lock screen with what its first render tells the strip, and
 * records every view a tap reaches.
 *
 * @param told - What the first render tells the strip.
 * @returns The app, its Pixi and the tapped views, in order.
 */
async function startLock(told: LockTold) {
  lockStart.told = told;

  const started = await startDrawnApp();
  const tapped: number[] = [];

  locking = started.app;
  started.app.world.projection.mount(["drawn.lock"], { kind: "plugin", name: "test" });
  await settle(started.app, 3);
  started.app.input.onTap(entity => tapped.push(entity));

  return { ...started, tapped };
}

/**
 * Sends one pointer event and steps its frame.
 *
 * @param app - The running app.
 * @param pixi - Its Pixi.
 * @param name - The DOM event name.
 * @param at - Where, in reference units.
 */
function finger(app: DrawnApp, pixi: DrawnPixi, name: string, at: DrawnPoint): void {
  pointer(app, pixi, name, at);
  step(app);
}

/**
 * Renders the lock screen again and steps the frame that settles it.
 *
 * @param app - The running app.
 * @param told - What the render tells the strip.
 */
function relock(app: DrawnApp, told: LockTold): void {
  renderLock(app, told);
  step(app);
}

/**
 * Steps frames of 16 ms.
 *
 * @param app - The running app.
 * @param count - How many.
 */
function steps(app: DrawnApp, count: number): void {
  for (let frame = 0; frame < count; frame += 1) step(app);
}

/**
 * Where a scroll stands, as a game reads it.
 *
 * @param app - The running app.
 * @param key - The key of the scroll.
 * @returns Its `ScrollState`.
 */
function shown(app: DrawnApp, key: string) {
  return app.world.ecs.get(entityOf(app, key), ScrollState);
}

/**
 * Presses the third card at offset 0 and moves the finger 20 u to the left per frame: the first
 * move hands the press to the strip, each one after it moves the strip 20 u.
 *
 * @param app - The running app.
 * @param pixi - Its Pixi.
 * @param moves - How many moves.
 * @param by - How far each move goes along x; -20 when left out.
 * @param from - Where the finger lands; the third card at offset 0 when left out.
 */
function pan(app: DrawnApp, pixi: DrawnPixi, moves: number, by = -20, from = ON_THIRD): void {
  finger(app, pixi, "pointerdown", from);

  for (let move = 1; move <= moves; move += 1) {
    finger(app, pixi, "pointermove", { x: from.x + by * move, y: from.y });
  }
}

describe("a locked scroll under the finger (F177)", () => {
  it.each([
    ["a card", ON_CARD],
    ["its background", ON_BACKGROUND]
  ])("L1: a drag from %s moves nothing in any frame and its release answers nothing", async (_from, from) => {
    // Bug caught: the locked strip still follows the finger, or flings or snap-glides after the
    // release, or the release answers the card's tap.
    const { app, pixi, tapped } = await startLock({ offset: 0 });

    relock(app, { offset: 0, locked: true });

    const offsets: number[] = [];
    const moving: boolean[] = [];

    finger(app, pixi, "pointerdown", from);

    for (let move = 1; move <= 4; move += 1) {
      finger(app, pixi, "pointermove", { x: from.x - 50 * move, y: from.y });
      offsets.push(shown(app, "lockStrip")?.offset ?? -1);
    }

    finger(app, pixi, "pointerup", { x: from.x - 200, y: from.y });

    for (let frame = 0; frame < 30; frame += 1) {
      step(app);
      offsets.push(shown(app, "lockStrip")?.offset ?? -1);
      moving.push(shown(app, "lockStrip")?.moving ?? true);
    }

    await settle(app, 1);

    expect(new Set(offsets)).toEqual(new Set([0]));
    expect(moving).not.toContain(true);
    expect(tapped).toEqual([]);
    expect(app.ui.find("shopPanel")).toBeUndefined();
  });

  it("L1b: a card press that drifts past the slop and comes back loses its press look and answers no tap", async () => {
    // Bug caught: the card keeps the press when the strip refuses it, so a finger that comes back
    // to its start buys the item.
    const { app, pixi, tapped } = await startLock({ offset: 0, locked: true });
    const card = entityOf(app, "lockCard0");

    finger(app, pixi, "pointerdown", ON_CARD);

    expect(app.world.ecs.has(card, Pressed)).toBe(true);

    finger(app, pixi, "pointermove", { x: ON_CARD.x + 30, y: ON_CARD.y });

    expect(app.world.ecs.has(card, Pressed)).toBe(false);

    finger(app, pixi, "pointermove", ON_CARD);
    finger(app, pixi, "pointerup", ON_CARD);
    await settle(app, 1);

    expect(tapped).toEqual([]);
    expect(app.ui.find("shopPanel")).toBeUndefined();
    expect(shown(app, "lockStrip")?.offset).toBe(0);
  });

  it("L2: a press on a card does not stop a glide to the offset; the card takes the press and its tap", async () => {
    // Bug caught: the finger stops the locked strip half way, or the strip swallows the press, so
    // the card under the finger answers nothing.
    const { app, pixi, tapped } = await startLock({ offset: 318, locked: true });
    const card = entityOf(app, "lockCard3");

    relock(app, { offset: 390, locked: true });
    steps(app, 5);
    finger(app, pixi, "pointerdown", ON_CARD);

    const pressedAt = shown(app, "lockStrip")?.offset ?? 0;

    expect(app.world.ecs.has(card, Pressed)).toBe(true);
    expect(pressedAt).toBeLessThan(390);

    steps(app, 2);

    expect(shown(app, "lockStrip")?.offset).toBeGreaterThan(pressedAt);

    pointer(app, pixi, "pointerup", ON_CARD);

    expect(tapped).toEqual([card]);

    steps(app, 20);
    await settle(app, 1);

    expect(shown(app, "lockStrip")).toEqual({ offset: 390, max: 390, moving: false });
    expect(app.ui.find("shopPanel")).toBeDefined();
  });

  it("L2b: a press does not stop a fling that the lock found running", async () => {
    // Bug caught: the finger catches the locked strip's fling and the card under it loses its tap.
    const { app, pixi, tapped } = await startLock({ offset: 0, snap: "none" });

    pan(app, pixi, 4, -15);
    finger(app, pixi, "pointerup", { x: ON_THIRD.x - 60, y: ON_THIRD.y });
    relock(app, { offset: 0, snap: "none", locked: true });

    expect(shown(app, "lockStrip")?.moving).toBe(true);

    finger(app, pixi, "pointerdown", ON_CARD);

    const pressedAt = shown(app, "lockStrip")?.offset ?? 0;

    steps(app, 2);

    expect(shown(app, "lockStrip")?.offset).toBeGreaterThan(pressedAt);

    pointer(app, pixi, "pointerup", ON_CARD);

    expect(tapped).toHaveLength(1);
  });

  it("L3a: a new offset with glideMs still glides there and stands on it at 150 ms", async () => {
    // Bug caught: the lock also stops the program from moving the strip.
    const { app } = await startLock({ offset: 0, locked: true });

    relock(app, { offset: 390, glideMs: 150, locked: true });
    steps(app, 4);

    expect(shown(app, "lockStrip")?.offset).toBeGreaterThan(0);
    expect(shown(app, "lockStrip")?.offset).toBeLessThan(390);

    steps(app, 6);

    expect(shown(app, "lockStrip")).toEqual({ offset: 390, max: 390, moving: false });
  });

  it("L3b: a new aim with the same offset glides a strip the finger left at 390 back to 0", async () => {
    // Bug caught: a locked strip ignores a new aim and stays where the player dragged it.
    const { app, pixi } = await startLock({ offset: 0 });

    pan(app, pixi, 4, -100);
    finger(app, pixi, "pointerup", { x: ON_THIRD.x - 400, y: ON_THIRD.y });
    steps(app, 40);

    expect(shown(app, "lockStrip")?.offset).toBe(390);

    relock(app, { offset: 0, locked: true });
    steps(app, 2);

    expect(shown(app, "lockStrip")?.offset).toBe(390);

    relock(app, { offset: 0, locked: true, aim: "order-7" });
    steps(app, 40);

    expect(shown(app, "lockStrip")).toEqual({ offset: 0, max: 390, moving: false });
  });

  it("L3c: jump with a new offset stands there in that settle", async () => {
    // Bug caught: a locked strip glides to a jumped offset, or ignores it.
    const { app } = await startLock({ offset: 0, locked: true });

    relock(app, { offset: 318, jump: true, locked: true });

    expect(shown(app, "lockStrip")).toEqual({ offset: 318, max: 390, moving: false });
  });

  it("L4: a tap on a card answers at the lift's own event, as on an unlocked strip", async () => {
    // Bug caught: the lock takes the card's press, or holds its answer back for a frame.
    const { app, pixi, tapped } = await startLock({ offset: 0, locked: true });
    const card = entityOf(app, "lockCard0");

    finger(app, pixi, "pointerdown", ON_CARD);

    expect(app.world.ecs.has(card, Pressed)).toBe(true);

    pointer(app, pixi, "pointerup", ON_CARD);

    expect(tapped).toEqual([card]);

    step(app);
    await settle(app, 1);

    expect(app.ui.find("shopPanel")).toBeDefined();
  });

  it.each([
    ["with snap, glides to the stop nearest to where it stands", undefined, 0],
    ["without snap, stands", "none", 60]
  ] as const)("L5: a held strip the lock reaches lets go with no velocity: %s", async (_case, snap, to) => {
    // Bug caught: the lock lets go with the finger's velocity (a fling, or the projected stop
    // 390), or the strip goes on following the finger, also after an unlock before the lift.
    const { app, pixi, tapped } = await startLock({ offset: 0, snap });
    const strip = entityOf(app, "lockStrip");

    pan(app, pixi, 4);

    expect(shown(app, "lockStrip")?.offset).toBe(60);

    relock(app, { offset: 0, snap, locked: true });
    step(app);

    expect(app.world.ecs.has(strip, Pressed)).toBe(false);

    const offsets: number[] = [];

    for (const x of [150, 130]) {
      finger(app, pixi, "pointermove", { x, y: ON_THIRD.y });
      offsets.push(shown(app, "lockStrip")?.offset ?? -1);
    }

    relock(app, { offset: 0, snap, locked: false });

    for (const x of [110, 90]) {
      finger(app, pixi, "pointermove", { x, y: ON_THIRD.y });
      offsets.push(shown(app, "lockStrip")?.offset ?? -1);
    }

    expect(app.world.ecs.has(strip, Pressed)).toBe(false);

    finger(app, pixi, "pointerup", { x: 90, y: ON_THIRD.y });
    steps(app, 40);

    expect(Math.max(...offsets)).toBeLessThanOrEqual(60);
    expect(shown(app, "lockStrip")).toEqual({ offset: to, max: 390, moving: false });
    expect(tapped).toEqual([]);

    // A new press after the lift drags again.
    pan(app, pixi, 2, -20, ON_CARD);

    expect(shown(app, "lockStrip")?.offset).toBe(to + 20);
  });

  it("L6: a render that locks a held strip and gives it a new offset glides there", async () => {
    // Bug caught: the lock drops the finger after the offset follow, which a held strip skips, so
    // the strip snaps to its nearest stop instead of the new offset.
    const { app, pixi } = await startLock({ offset: 318 });

    pan(app, pixi, 5, 20, ON_CARD);

    expect(shown(app, "lockStrip")?.offset).toBe(238);

    relock(app, { offset: 0, locked: true });
    steps(app, 50);

    expect(shown(app, "lockStrip")).toEqual({ offset: 0, max: 390, moving: false });
  });

  it("L6b: an offset only remembered while held is not followed when a later render locks", async () => {
    // Bug caught: the drop follows an offset prop the render of the lock did not change.
    const { app, pixi } = await startLock({ offset: 318 });

    pan(app, pixi, 5, 20, ON_CARD);
    relock(app, { offset: 0 });

    expect(shown(app, "lockStrip")?.offset).toBe(238);

    relock(app, { offset: 0, locked: true });
    steps(app, 50);

    expect(shown(app, "lockStrip")).toEqual({ offset: 318, max: 390, moving: false });
  });

  it("L7: a drag along x on a locked strip inside an unlocked x scroll moves neither", async () => {
    // Bug caught: the hand-off passes over the locked strip to the outer scroll of its axis.
    const { app, pixi } = await startLock({ offset: 0, locked: true, outer: "x" });

    await drag(app, pixi, ON_CARD, { x: ON_CARD.x - 200, y: ON_CARD.y });
    await settle(app, 30);

    expect(shown(app, "lockStrip")?.offset).toBe(0);
    expect(shown(app, "lockOuter")?.offset).toBe(0);
  });

  it.each([false, 1, "yes"])("L8: locked={%s} drags as an unlocked strip", async locked => {
    // Bug caught: a value other than `true` locks the strip.
    const { app, pixi } = await startLock({ offset: 0, locked });

    pan(app, pixi, 4);

    expect(shown(app, "lockStrip")?.offset).toBe(60);
  });

  it("L9: after an unlock a new press drags and flings again", async () => {
    // Bug caught: the unlock never reaches `input`, so the strip stays locked to the finger.
    const { app, pixi } = await startLock({ offset: 0, snap: "none" });

    relock(app, { offset: 0, snap: "none", locked: true });
    relock(app, { offset: 0, snap: "none", locked: false });
    pan(app, pixi, 4, -15);

    expect(shown(app, "lockStrip")?.offset).toBe(45);

    finger(app, pixi, "pointerup", { x: ON_THIRD.x - 60, y: ON_THIRD.y });
    steps(app, 3);

    expect(shown(app, "lockStrip")?.moving).toBe(true);
    expect(shown(app, "lockStrip")?.offset).toBeGreaterThan(45);
  });

  it("L10: a locked x strip in a y page keeps a vertical drag from its background; one from a card pans the page", async () => {
    // Bug caught: a press on the locked strip's background goes on to the page, or the lock also
    // keeps a vertical pan from a card away from the page.
    const { app, pixi } = await startLock({ offset: 0, locked: true, outer: "y" });

    await drag(app, pixi, ON_BACKGROUND, { x: ON_BACKGROUND.x, y: ON_BACKGROUND.y - 200 });
    await settle(app, 30);

    expect(shown(app, "lockOuter")?.offset).toBe(0);
    expect(shown(app, "lockStrip")?.offset).toBe(0);

    await drag(app, pixi, ON_CARD, { x: ON_CARD.x, y: ON_CARD.y - 200 });

    expect(shown(app, "lockOuter")?.offset).toBeGreaterThanOrEqual(150);
    expect(shown(app, "lockStrip")?.offset).toBe(0);
  });

  it("L11: a strip whose first render is locked moves nothing in its first frames", async () => {
    // Bug caught: the lock reaches `input` only after a later render, so the first drag pans.
    const { app, pixi } = await startLock({ offset: 0, locked: true });
    const strip = entityOf(app, "lockStrip");

    pan(app, pixi, 2);

    expect(app.world.ecs.has(strip, Pressed)).toBe(false);
    expect(shown(app, "lockStrip")?.offset).toBe(0);
  });
});
