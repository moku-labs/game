/**
 * @file Root integration — `Overlay({ hudInert })` across renderer, ui and input (change 2026-11-10-f164-hud-inert,
 * F164). The sheets game rests on the ward with its HUD bar (the shop button is a `HudPart` with the intent `shop`); a
 * ui-owned overlay is laid over it the way `ui` lays one, and a finger presses the canvas at the button's centre through
 * the real hit test: renderer `hitTest` -> input `findPressed` -> `Pressed` -> the intent -> the flow.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pressed } from "../../src/plugins/input/components";
import {
  Overlay,
  OverlayLevel,
  type OverlayValue,
  Shape,
  Transform
} from "../../src/plugins/renderer/components";
import { Layer } from "../../src/plugins/world/ecs/define";
import { closeSheets, findKey, openSheets, type Sheets } from "./sheets-helpers";

const running: Sheets[] = [];

afterEach(async () => {
  for (const sheets of running.splice(0)) await closeSheets(sheets);
  vi.unstubAllGlobals();
});

/** The owner `ui` gives its elements: the only overlays the renderer honours. */
const UI_OWNER = { kind: "plugin", name: "ui" } as const;

/**
 * Opens the sheets game on the ward, closed by `afterEach`.
 *
 * @returns The running game.
 */
async function openWard(): Promise<Sheets> {
  const sheets = await openSheets();

  running.push(sheets);

  return sheets;
}

/**
 * Lays an overlay of the `ui` layer over the ward, landed, and lets the renderer see it for a few frames.
 *
 * @param sheets - The running game.
 * @param value - What the overlay says.
 * @returns The overlay.
 */
async function lay(sheets: Sheets, value: Partial<OverlayValue>): Promise<number> {
  const overlay = sheets.app.world.ecs.spawn(UI_OWNER, [
    Layer({ name: "ui" }),
    Transform(),
    Shape({ w: 1080, h: 1920, fill: 0x1b_14_30, alpha: 1 }),
    Overlay({ dim: 0.7, ...value }),
    OverlayLevel({ level: 1, landed: true })
  ]);

  await sheets.frames(3);

  return overlay;
}

/** A finger on the canvas. */
type Finger = { down: () => void; up: () => void };

/**
 * A finger over the centre of a keyed HUD button, as the page's canvas gets it.
 *
 * @param sheets - The running game.
 * @param key - The element's key.
 * @returns Its press and its lift.
 */
function fingerOn(sheets: Sheets, key: string): Finger {
  const rect = sheets.app.ui.rectOf({ projection: "hud.bar", key });

  if (rect === undefined) throw new Error(`${key} is not shown`);

  const at = sheets.app.renderer.viewport.toScreen({
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2
  });
  const canvas = sheets.page.stage.last().canvas;
  const send = (name: string): void => {
    canvas.dispatch(name, {
      pointerType: "touch",
      pointerId: 1,
      clientX: at.x,
      clientY: at.y,
      preventDefault: () => undefined
    });
  };

  return { down: () => send("pointerdown"), up: () => send("pointerup") };
}

/**
 * Whether the keyed button carries `Pressed` now.
 *
 * @param sheets - The running game.
 * @param key - The element's key.
 * @returns True while a finger presses it.
 */
function pressed(sheets: Sheets, key: string): boolean {
  const entity = findKey(sheets.app, key);

  return entity !== undefined && sheets.app.world.ecs.has(entity, Pressed);
}

describe("Overlay({ hudInert }) across the HUD button", () => {
  // Bug: the whole chain does not reach ui: the renderer keeps the part tappable, so a finger on an inert HUD button
  // presses it and the flow opens the shop under the suitcase.
  it("a tap on an inert HUD button makes no press and no intent", async () => {
    const sheets = await openWard();

    await lay(sheets, { hud: ["shop"], hudInert: true });

    const finger = fingerOn(sheets, "shopButton");

    finger.down();
    expect(pressed(sheets, "shopButton")).toBe(false);
    finger.up();
    await sheets.frames(30);
    expect(sheets.app.flow.state().path).toBe("ward");
  });

  it("the same overlay with hudInert false lets the button take the press and send its intent", async () => {
    const sheets = await openWard();

    await lay(sheets, { hud: ["shop"], hudInert: false });

    const finger = fingerOn(sheets, "shopButton");

    finger.down();
    expect(pressed(sheets, "shopButton")).toBe(true);
    finger.up();
    await sheets.until("shopping/shop");
  });
});

/** What a press held across the arrival of an overlay does, read from the game. */
type Held = { pressedBefore: boolean; pressedDuring: boolean; path: string; pressedAfter: boolean };

/**
 * Presses the shop button, lays the overlay, lifts the finger.
 *
 * @param value - What the overlay says.
 * @returns What the button and the flow did.
 */
async function holdAcross(value: Partial<OverlayValue>): Promise<Held> {
  const sheets = await openWard();
  const finger = fingerOn(sheets, "shopButton");

  finger.down();

  const pressedBefore = pressed(sheets, "shopButton");

  await lay(sheets, value);

  const pressedDuring = pressed(sheets, "shopButton");

  finger.up();
  await sheets.frames(40);

  return {
    pressedBefore,
    pressedDuring,
    path: sheets.app.flow.state().path,
    pressedAfter: pressed(sheets, "shopButton")
  };
}

describe("a press held when the overlay arrives", () => {
  // Bug: a press that leaks an intent through an inert part where a part that starts to fade does not, or the other way
  // round. Pinned from the code as it is (input/hit.ts finds the target at the press only; the release does no hit
  // test): the press that is down stays down, the overlay's arrival does not cancel it, and the release sends the
  // intent. An inert part behaves as a part that starts to fade.
  it("behaves for an inert part as for a part that starts to fade: the press stays, the release answers its intent", async () => {
    const inert = await holdAcross({ hud: ["shop"], hudInert: true });
    const fading = await holdAcross({ hud: "none", hudInert: false });

    expect(inert).toEqual({
      pressedBefore: true,
      pressedDuring: true,
      path: "shopping/shop",
      pressedAfter: false
    });
    expect(inert).toEqual(fading);
  });
});
