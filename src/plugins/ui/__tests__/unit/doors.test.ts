import { describe, expect, it } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import type { Api as RendererApi } from "../../../renderer/types";
import type { Point } from "../../../renderer/viewport/types";
import { rectSource, uiSource } from "../../inspect";
import type { UiApi, UiNode } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: the ui sources of the /inspect door over a hand-built screen and
// a viewport that maps reference units to CSS px
// ---------------------------------------------------------------------------

/** No state flag set. */
const idle: UiNode["state"] = {
  pressed: false,
  hover: false,
  focus: false,
  disabled: false,
  active: false,
  selected: false,
  covered: false
};

/**
 * Builds one snapshot node.
 *
 * @param key - The key of the element.
 * @param rect - Its natural rect in root coordinates.
 * @param children - Its children.
 * @param fitScale - The scale its own `fit: "contain"` draws it at, if any.
 * @returns The node.
 */
function node(
  key: string | undefined,
  rect: UiNode["rect"],
  children: UiNode[] = [],
  fitScale?: number
): UiNode {
  const base: UiNode = { key, type: "stack", rect, style: {}, state: idle, children };

  return fitScale === undefined ? base : { ...base, fitScale };
}

/**
 * A short phone: a 1000 x 2400 u sheet popup fitted at 0.75 into a 1080 x 1800 u screen, over a
 * HUD with a bare button that has no fill.
 */
const shortScreen = node(undefined, { x: 0, y: 0, w: 0, h: 0 }, [
  node(
    "sheet",
    { x: 40, y: -300, w: 1000, h: 2400 },
    [
      node("ok", { x: 440, y: 1900, w: 200, h: 100 }),
      node(
        "inner",
        { x: 140, y: 100, w: 800, h: 800 },
        [node("deep", { x: 540, y: 500, w: 100, h: 100 })],
        0.5
      )
    ],
    0.75
  ),
  node("bar", { x: 0, y: 0, w: 1080, h: 120 }, [node("settings", { x: 10, y: 10, w: 100, h: 100 })])
]);

/** The keys `ui.find` answers for: every key of the short screen. */
const onScreen = new Set(["sheet", "ok", "inner", "deep", "bar", "settings"]);

/**
 * Builds an app whose ui answers the short screen and whose viewport maps reference units to
 * CSS px the way a 390 px wide phone does, the canvas 8 px from the left of the page.
 *
 * @param scale - CSS px per reference unit.
 * @returns The app the ui sources read.
 */
function phone(scale = 390 / 1080) {
  const base = createApp();

  return {
    ...base,
    ui: {
      tree: (): UiNode => shortScreen,
      find: (key: string): number | undefined => (onScreen.has(key) ? 1 : undefined),
      lint: () => []
    },
    renderer: {
      viewport: {
        toScreen: (point: Point): Point => ({ x: 8 + point.x * scale, y: point.y * scale })
      }
    }
  } as unknown as typeof base & { ui: UiApi; renderer: RendererApi };
}

describe("game.ui", () => {
  it("is a frame source that reads the live screen", () => {
    const app = phone();

    expect(uiSource.id).toBe("game.ui");
    expect(uiSource.changes).toBe("frame");
    expect(read(app, uiSource)).toBe(shortScreen);
  });
});

describe("game.rect", () => {
  it("is a frame source keyed by the element key", () => {
    expect(rectSource.id).toBe("game.rect");
    expect(rectSource.changes).toBe("frame");
    expect(rectSource.input).toEqual({ key: "string" });
  });

  it("maps a bare button with no fill to CSS px of the page", () => {
    const app = phone(0.5);

    expect(read(app, rectSource, { key: "settings" })).toEqual({ x: 13, y: 5, w: 50, h: 50 });
  });

  it("scales an element inside a fitted popup on a short screen about the popup's centre", () => {
    const app = phone(1);
    // The sheet's centre is (540, 900): the button lands at 540 + 0.75 x (440 - 540), 900 + 0.75 x (1900 - 900).
    const drawn = { x: 465, y: 1650, w: 150, h: 75 };

    expect(read(app, rectSource, { key: "ok" })).toEqual({ ...drawn, x: drawn.x + 8 });
  });

  it("scales the fitted element itself about its own centre", () => {
    const app = phone(1);

    // 1000 x 2400 at 0.75 about (540, 900): 750 x 1800 from (165, 0).
    expect(read(app, rectSource, { key: "sheet" })).toEqual({ x: 173, y: 0, w: 750, h: 1800 });
  });

  it("applies every fitted ancestor, the nearest first", () => {
    const app = phone(1);
    // inner at 0.5 about (540, 500): (540, 500) stays, 50 x 50; then the sheet at 0.75 about
    // (540, 900): x stays on the centre line, y moves to 900 + 0.75 x (500 - 900).
    const x = 540;
    const y = 900 + 0.75 * (500 - 900);

    expect(read(app, rectSource, { key: "deep" })).toEqual({
      x: x + 8,
      y,
      w: 37.5,
      h: 37.5
    });
  });

  it("answers undefined for a key that is not on screen", () => {
    const app = phone();

    expect(read(app, rectSource, { key: "nothing" })).toBeUndefined();
  });

  it("answers undefined for a key ui finds but the snapshot does not hold", () => {
    const app = phone();

    onScreen.add("leaving");

    expect(read(app, rectSource, { key: "leaving" })).toBeUndefined();

    onScreen.delete("leaving");
  });
});
