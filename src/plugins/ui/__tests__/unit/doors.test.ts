import { describe, expect, it } from "vitest";
import { createApp } from "../../../../index";
import { read } from "../../../flow/doors/read";
import { Parent, Shape, Transform, type TransformValue } from "../../../renderer/components";
import type { HitBox } from "../../../renderer/sync/types";
import type { Api as RendererApi } from "../../../renderer/types";
import type { Point } from "../../../renderer/viewport/types";
import type { Api as WorldApi } from "../../../world/types";
import { Box } from "../../components";
import { locateSource, uiSource } from "../../inspect";
import { restTransform } from "../../layout/motion";
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

/** One element of the hand-built world: its rect, its fit, its parent, a scroll offset on y, a clip. */
type Placed = {
  rect: UiNode["rect"];
  fit?: number;
  parent?: string;
  scrollY?: number;
  clip?: boolean;
};

/**
 * The short screen as ui writes it into the world, and a 400 x 200 u list at (0, 1000) scrolled
 * by 150 u, which clips its rows: row `r0` is scrolled out, `r1` half in, `r2` whole.
 */
const placed: Record<string, Placed> = {
  sheet: { rect: { x: 40, y: -300, w: 1000, h: 2400 }, fit: 0.75 },
  ok: { rect: { x: 440, y: 1900, w: 200, h: 100 }, parent: "sheet" },
  inner: { rect: { x: 140, y: 100, w: 800, h: 800 }, fit: 0.5, parent: "sheet" },
  deep: { rect: { x: 540, y: 500, w: 100, h: 100 }, parent: "inner" },
  bar: { rect: { x: 0, y: 0, w: 1080, h: 120 } },
  settings: { rect: { x: 10, y: 10, w: 100, h: 100 }, parent: "bar" },
  list: { rect: { x: 0, y: 1000, w: 400, h: 200 }, clip: true },
  rows: { rect: { x: 0, y: 1000, w: 400, h: 400 }, parent: "list", scrollY: 150 },
  r0: { rect: { x: 0, y: 1000, w: 400, h: 80 }, parent: "rows" },
  r1: { rect: { x: 0, y: 1080, w: 400, h: 80 }, parent: "rows" },
  r2: { rect: { x: 0, y: 1160, w: 400, h: 80 }, parent: "rows" }
};

/** The entity of every placed key, from 1, and of `leaving`, which has no `Box`. */
const entities = new Map([...Object.keys(placed), "leaving"].map((key, index) => [key, index + 1]));

/** The key of every entity. */
const keys = new Map([...entities].map(([key, entity]) => [entity, key]));

/**
 * The rest pose ui writes for a placed element, moved by its scroll offset.
 *
 * @param element - The element.
 * @returns Its local `Transform`.
 */
function poseOf(element: Placed): TransformValue {
  const parent = element.parent === undefined ? undefined : placed[element.parent]?.rect;
  const pose = restTransform(element.rect, parent, {}, element.fit);

  return { ...pose, y: pose.y - (element.scrollY ?? 0) };
}

/**
 * Reads a component of the hand-built world.
 *
 * @param entity - The entity.
 * @param type - The component.
 * @returns Its value, or `undefined`.
 */
function getOf(entity: number, type: unknown): unknown {
  const element = placed[keys.get(entity) ?? ""];

  if (element === undefined) return undefined;
  if (type === Box) return element.rect;
  if (type === Transform) return poseOf(element);
  if (type === Parent) {
    return element.parent === undefined ? undefined : { entity: entities.get(element.parent) };
  }
  if (type === Shape && element.clip === true) {
    return { kind: "rect", w: element.rect.w, h: element.rect.h, clip: true };
  }

  return undefined;
}

/** The one view of the world the target tests address: a coin of the board, entity 7. */
const coin = { projection: "board.items", key: "i5", entity: 7 } as const;

/** Where the renderer draws the coin: 64 x 64 at (540, 300) with the default anchor. */
const coinBounds: HitBox = { x: 508, y: 268, width: 64, height: 64 };

/**
 * Builds an app whose ui answers the short screen, whose world knows one coin view and whose
 * viewport maps reference units to CSS px the way a 390 px wide phone does, the canvas 8 px from
 * the left of the page.
 *
 * @param scale - CSS px per reference unit.
 * @param drawn - Whether the renderer draws the coin.
 * @returns The app the ui sources read.
 */
function phone(scale = 390 / 1080, drawn = true) {
  const bounds = drawn ? coinBounds : undefined;
  const base = createApp();

  return {
    ...base,
    ui: {
      tree: (): UiNode => shortScreen,
      find: (key: string): number | undefined => entities.get(key),
      lint: () => []
    },
    renderer: {
      viewport: {
        toScreen: (point: Point): Point => ({ x: 8 + point.x * scale, y: point.y * scale })
      },
      sync: {
        boundsOf: (entity: number): HitBox | undefined =>
          entity === coin.entity ? bounds : undefined
      }
    },
    world: {
      ecs: { get: getOf },
      projection: {
        entityOf: (projection: string, key: string): number | undefined =>
          projection === coin.projection && key === coin.key ? coin.entity : undefined
      }
    }
  } as unknown as typeof base & { ui: UiApi; renderer: RendererApi; world: WorldApi };
}

describe("game.ui", () => {
  it("is a frame source that reads the live screen", () => {
    const app = phone();

    expect(uiSource.id).toBe("game.ui");
    expect(uiSource.changes).toBe("frame");
    expect(read(app, uiSource)).toBe(shortScreen);
  });
});

describe("game.locate", () => {
  it("is a frame source that takes a key or a target", () => {
    expect(locateSource.id).toBe("game.locate");
    expect(locateSource.changes).toBe("frame");
    expect(locateSource.input).toEqual({ key: "string?", target: "json?" });
  });

  it("maps a bare button with no fill to CSS px of the page", () => {
    const app = phone(0.5);

    expect(read(app, locateSource, { key: "settings" })).toEqual({ x: 13, y: 5, w: 50, h: 50 });
  });

  it("scales an element inside a fitted popup on a short screen about the popup's centre", () => {
    const app = phone(1);
    // The sheet's centre is (540, 900): the button lands at 540 + 0.75 x (440 - 540), 900 + 0.75 x (1900 - 900).
    const drawn = { x: 465, y: 1650, w: 150, h: 75 };

    expect(read(app, locateSource, { key: "ok" })).toEqual({ ...drawn, x: drawn.x + 8 });
  });

  it("scales the fitted element itself about its own centre", () => {
    const app = phone(1);

    // 1000 x 2400 at 0.75 about (540, 900): 750 x 1800 from (165, 0).
    expect(read(app, locateSource, { key: "sheet" })).toEqual({ x: 173, y: 0, w: 750, h: 1800 });
  });

  it("applies every fitted ancestor, the nearest first", () => {
    const app = phone(1);
    // inner at 0.5 about (540, 500): (540, 500) stays, 50 x 50; then the sheet at 0.75 about
    // (540, 900): x stays on the centre line, y moves to 900 + 0.75 x (500 - 900).
    const x = 540;
    const y = 900 + 0.75 * (500 - 900);

    expect(read(app, locateSource, { key: "deep" })).toEqual({
      x: x + 8,
      y,
      w: 37.5,
      h: 37.5
    });
  });

  it("answers undefined for a key that is not on screen", () => {
    const app = phone();

    expect(read(app, locateSource, { key: "nothing" })).toBeUndefined();
  });

  it("answers undefined for a key ui finds with no laid-out box", () => {
    expect(read(phone(), locateSource, { key: "leaving" })).toBeUndefined();
  });

  it("moves a row by the offset its scroll writes and cuts it to the scroll's clip (F39)", () => {
    // Bug caught: locate gave the layout box, so a row scrolled out of its list was still found
    // where the list draws another one, and the editor's picker picked it there.
    const app = phone(1);

    expect(read(app, locateSource, { key: "r0" })).toBeUndefined();
    expect(read(app, locateSource, { key: "r1" })).toEqual({ x: 8, y: 1000, w: 400, h: 10 });
    expect(read(app, locateSource, { key: "r2" })).toEqual({ x: 8, y: 1010, w: 400, h: 80 });
  });

  it("never cuts the clipping element by its own clip", () => {
    expect(read(phone(1), locateSource, { key: "list" })).toEqual({
      x: 8,
      y: 1000,
      w: 400,
      h: 200
    });
  });

  it("maps the drawn box of a view, named by its target, to CSS px of the page", () => {
    const app = phone(0.5);
    const target = { projection: coin.projection, key: coin.key };

    // (508, 268) to (572, 332) at 0.5 px per unit, 8 px in: (262, 134) to (294, 166).
    expect(read(app, locateSource, { target })).toEqual({ x: 262, y: 134, w: 32, h: 32 });
  });

  it("answers undefined for a target no live view has, and for a view with no drawn box", () => {
    expect(
      read(phone(), locateSource, { target: { projection: "board.items", key: "gone" } })
    ).toBeUndefined();
    expect(
      read(phone(1, false), locateSource, {
        target: { projection: coin.projection, key: coin.key }
      })
    ).toBeUndefined();
  });

  it("throws unless exactly one of key and target is given", () => {
    const app = phone();
    const message =
      "[game] game.locate takes a key or a target.\n  Pass exactly one of { key } and { target }.";

    expect(() => read(app, locateSource, {})).toThrow(message);
    expect(() =>
      read(app, locateSource, { key: "ok", target: { projection: coin.projection, key: coin.key } })
    ).toThrow(message);
  });

  it("refuses a target that is not a projection key", () => {
    expect(() => read(phone(), locateSource, { target: "i5" })).toThrow(
      "[game] The target is not a projection key."
    );
  });
});
