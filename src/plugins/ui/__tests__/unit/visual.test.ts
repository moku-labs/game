import { describe, expect, it } from "vitest";
import type { Element } from "../../jsx/types";
import { restTransform } from "../../layout/motion";
import { fitInto } from "../../layout/solve";
import { fitScaleOf, samePose, scaleByFits, visualOf, visualRectOf } from "../../visual";

/**
 * Builds the smallest element the visual helpers read.
 *
 * @param patch - What to change about it.
 * @returns The element.
 */
function elementOf(patch: Partial<Element> = {}): Element {
  return {
    entity: 1,
    identity: "0|row@0|row",
    type: "row",
    key: "bar",
    parentType: undefined,
    root: 0,
    node: { type: "row", props: {}, children: [] },
    style: {},
    is: {
      pressed: false,
      hover: false,
      focus: false,
      disabled: false,
      active: false,
      selected: false,
      covered: false
    },
    rect: { x: 0, y: 0, w: 200, h: 100 },
    previous: { x: 0, y: 0, w: 0, h: 0 },
    moved: false,
    fit: 1,
    rest: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
    handles: [],
    loop: undefined,
    motion: undefined,
    parent: undefined,
    children: [],
    instance: undefined,
    live: false,
    entered: false,
    dropKey: undefined,
    ...patch
  };
}

// ─── the visual component of an element ───────────────────────

describe("visualOf", () => {
  it("draws the nine-slice of the style on any tag, at the rect, with alpha and tint", () => {
    for (const type of ["button", "row", "stack", "panel"]) {
      const [value] = visualOf(
        elementOf({ type, style: { nineSlice: "ui.card", alpha: 0.5, tint: 0x80_80_80 } })
      );

      expect(value?.type.componentName).toBe("NineSlice");
      expect(value?.value).toEqual({
        texture: "ui.card",
        width: 200,
        height: 100,
        alpha: 0.5,
        tint: 0x80_80_80,
        debug: false
      });
    }
  });

  it("passes debug of the style into the nine-slice, so the renderer outlines its slices", () => {
    const [outlined] = visualOf(elementOf({ style: { nineSlice: "ui.card", debug: true } }));
    const [plain] = visualOf(elementOf({ style: { nineSlice: "ui.card" } }));

    expect(outlined?.value).toMatchObject({ texture: "ui.card", debug: true });
    expect(plain?.value).toMatchObject({ debug: false });
  });

  it("sizes an image to its rect with the fit of its prop, contain by default", () => {
    const contained = visualOf(
      elementOf({
        type: "image",
        node: { type: "image", props: { texture: "ui.coin" }, children: [] }
      })
    )[0];
    const covered = visualOf(
      elementOf({
        type: "icon",
        style: { tint: 0x11_22_33 },
        node: { type: "icon", props: { name: "ui.gear", fit: "cover" }, children: [] }
      })
    )[0];

    expect(contained?.value).toMatchObject({
      texture: "ui.coin",
      width: 200,
      height: 100,
      fit: "contain"
    });
    expect(covered?.value).toMatchObject({ texture: "ui.gear", fit: "cover", tint: 0x11_22_33 });
  });

  it("clips a scroll container and an element with overflow hidden, with no nine-slice", () => {
    const hidden = visualOf(elementOf({ style: { overflow: "hidden", nineSlice: "ui.card" } }))[0];
    const scroll = visualOf(elementOf({ type: "scroll" }))[0];
    const plain = visualOf(elementOf())[0];

    expect(hidden?.type.componentName).toBe("Shape");
    expect(hidden?.value).toMatchObject({ clip: true, w: 200, h: 100 });
    expect(scroll?.value).toMatchObject({ clip: true });
    expect(plain?.value).toMatchObject({ clip: false, alpha: 0 });
  });

  it("paints nothing inside a style with no fill: a ring, a frame, a bare button", () => {
    const ring = visualOf(
      elementOf({ type: "button", style: { stroke: 0xff_c2_33, strokeWidth: 6 } })
    )[0];
    const framed = visualOf(elementOf({ style: { stroke: 0xff_c2_33 } }))[0];
    const filled = visualOf(
      elementOf({ type: "button", style: { fill: 0x10_20_30, stroke: 0xff_c2_33 } })
    )[0];
    const plain = visualOf(elementOf({ type: "button" }))[0];

    expect(ring?.value).toMatchObject({
      fillAlpha: 0,
      alpha: 1,
      stroke: 0xff_c2_33,
      strokeWidth: 6
    });
    expect(framed?.value).toMatchObject({ fillAlpha: 0, alpha: 1 });
    expect(filled?.value).toMatchObject({ fillAlpha: 1, fill: 0x10_20_30 });
    // A text link is a button with no fill: its label is all it shows, never a white box.
    expect(plain?.value).toMatchObject({ fillAlpha: 0, alpha: 1 });
  });
});

// ─── the rest transform ───────────────────────────────────────

describe("restTransform", () => {
  const rect = { x: 40, y: 80, w: 100, h: 60 };
  const parent = { x: 10, y: 20, w: 500, h: 500 };

  it("turns around the centre by default and keeps the unscaled pose", () => {
    expect(restTransform(rect, parent, {}, 1)).toEqual({
      x: 30 + 50,
      y: 60 + 30,
      rotation: 0,
      scale: 1,
      pivot: { x: 50, y: 30 }
    });
  });

  it("keeps the top-left corner as the pivot for origin topLeft, as before delta 4", () => {
    expect(restTransform(rect, undefined, { origin: "topLeft" }, 1)).toEqual({
      x: 40,
      y: 80,
      rotation: 0,
      scale: 1,
      pivot: { x: 0, y: 0 }
    });
  });

  it("takes the top and a point in fractions of the box as the origin", () => {
    expect(restTransform(rect, parent, { origin: "top" }, 1).pivot).toEqual({ x: 50, y: 0 });
    expect(restTransform(rect, parent, { origin: { x: 0.25, y: 1 } }, 1).pivot).toEqual({
      x: 25,
      y: 60
    });
  });

  it("hangs the pivot above the box for a negative origin y and keeps the box on its rect", () => {
    const pose = restTransform(rect, parent, { origin: { x: 0.5, y: -0.5 } }, 1);

    // The rope anchor of a popup: half the height above the top edge, in the middle.
    expect(pose).toEqual({ x: 80, y: 30, rotation: 0, scale: 1, pivot: { x: 50, y: -30 } });
    // The unscaled box still sits on its rect, relative to the parent: (30, 60).
    expect({ x: pose.x - pose.pivot.x, y: pose.y - pose.pivot.y }).toEqual({ x: 30, y: 60 });
  });

  it("adds the offsets and the scale of the style", () => {
    expect(restTransform(rect, parent, { offsetX: 4, offsetY: -8, scale: 1.2 }, 1)).toEqual({
      x: 30 + 50 + 4,
      y: 60 + 30 - 8,
      rotation: 0,
      scale: 1.2,
      pivot: { x: 50, y: 30 }
    });
  });

  it("scales a fitted element about its centre, whatever its origin", () => {
    const pose = restTransform(rect, parent, { origin: "top", offsetY: 10 }, 0.5);

    expect(pose.scale).toBe(0.5);
    expect(pose.pivot).toEqual({ x: 50, y: 0 });
    // The centre of the box lands where it would at fit 1: the local centre (80, 90).
    const centre = {
      x: pose.x + pose.scale * (50 - pose.pivot.x),
      y: pose.y + pose.scale * (30 - pose.pivot.y)
    };

    expect(centre.x).toBe(80);
    // The offset of the style is in the element's own units, so it shrinks with the fit.
    expect(centre.y).toBe(90 + 5);
  });
});

// ─── fit contain ──────────────────────────────────────────────

describe("fitInto", () => {
  it("centres a box in the content box and scales it to fit", () => {
    expect(fitInto({ x: 20, y: 320, w: 1040, h: 776 }, 970, 970)).toEqual({
      rect: { x: 55, y: 320 + (776 - 970) / 2, w: 970, h: 970 },
      fit: 776 / 970
    });
  });

  it("never scales up", () => {
    expect(fitInto({ x: 0, y: 0, w: 2000, h: 2000 }, 970, 970).fit).toBe(1);
  });

  it("answers scale 1 for an empty box and 0 for a content box with no room", () => {
    expect(fitInto({ x: 0, y: 0, w: 100, h: 100 }, 0, 0).fit).toBe(1);
    expect(fitInto({ x: 0, y: 0, w: -10, h: 100 }, 50, 50).fit).toBe(0);
  });
});

describe("fitScaleOf and visualRectOf", () => {
  const slot = elementOf({ entity: 1, rect: { x: 0, y: 300, w: 1080, h: 800 } });
  const board = elementOf({
    entity: 2,
    parent: 1,
    rect: { x: 55, y: 215, w: 970, h: 970 },
    fit: 0.8
  });
  const cell = elementOf({
    entity: 3,
    parent: 2,
    rect: { x: 155, y: 315, w: 140, h: 140 }
  });
  const elements = new Map([
    [1, slot],
    [2, board],
    [3, cell]
  ]);
  const lookup = (entity: number): Element | undefined => elements.get(entity);

  it("multiplies the fit scales of the element and its ancestors", () => {
    expect(fitScaleOf(cell, lookup)).toBe(0.8);
    expect(fitScaleOf(board, lookup)).toBe(0.8);
    expect(fitScaleOf(slot, lookup)).toBe(1);
  });

  it("maps a natural rect to where it is drawn, about the centre of every fitted ancestor", () => {
    const centre = { x: 55 + 485, y: 215 + 485 };

    expect(visualRectOf(cell, lookup)).toEqual({
      x: centre.x + 0.8 * (155 - centre.x),
      y: centre.y + 0.8 * (315 - centre.y),
      w: 140 * 0.8,
      h: 140 * 0.8
    });
    expect(visualRectOf(slot, lookup)).toEqual(slot.rect);
  });
});

describe("scaleByFits", () => {
  it("scales a rect about the centre of every fitted link, nearest first", () => {
    const rect = { x: 0, y: 0, w: 100, h: 100 };
    const chain = [
      { rect, fit: 0.5 },
      { rect: { x: 0, y: 0, w: 200, h: 200 }, fit: 0.5 }
    ];

    expect(scaleByFits(rect, chain)).toEqual({ x: 62.5, y: 62.5, w: 25, h: 25 });
  });

  it("returns a copy of the rect when no link fits", () => {
    const rect = { x: 10, y: 20, w: 30, h: 40 };
    const drawn = scaleByFits(rect, [{ rect, fit: 1 }]);

    expect(drawn).toEqual(rect);
    expect(drawn).not.toBe(rect);
  });
});

describe("samePose", () => {
  it("compares every field of two transforms, the pivot included", () => {
    const pose = { x: 1, y: 2, rotation: 0, scale: 1, pivot: { x: 3, y: 4 } };

    expect(samePose(pose, { ...pose, pivot: { x: 3, y: 4 } })).toBe(true);
    expect(samePose(pose, { ...pose, pivot: { x: 3, y: 5 } })).toBe(false);
    expect(samePose(pose, { ...pose, scale: 2 })).toBe(false);
  });
});

// ─── delta 6: rotation, triangle and dash ─────────────────────

describe("the delta 6 looks", () => {
  it("writes the rotation into the rest pose around the origin of the style", () => {
    expect(
      restTransform({ x: 0, y: 0, w: 200, h: 80 }, undefined, { rotation: -0.026, origin: "top" })
    ).toEqual({ x: 100, y: 0, rotation: -0.026, scale: 1, pivot: { x: 100, y: 0 } });
    // Around the centre by default: the pivot lands where the unturned centre was.
    expect(
      restTransform(
        { x: 40, y: 80, w: 100, h: 60 },
        { x: 10, y: 20, w: 500, h: 500 },
        {
          rotation: 0.5
        }
      )
    ).toEqual({ x: 80, y: 90, rotation: 0.5, scale: 1, pivot: { x: 50, y: 30 } });
  });

  it("passes the shape and the dash of the style to the rectangle", () => {
    const [triangle] = visualOf(
      elementOf({
        type: "button",
        style: { shape: "triangle", fill: 0xff_fb_e8, stroke: 0x3a_22_12, strokeWidth: 4, dash: 10 }
      })
    );

    expect(triangle?.value).toMatchObject({ kind: "triangle", dash: 10, fillAlpha: 1, w: 200 });

    const [plain] = visualOf(elementOf({ type: "button", style: { fill: 1 } }));

    expect(plain?.value).toMatchObject({ kind: "rect", dash: 0 });
  });
});
