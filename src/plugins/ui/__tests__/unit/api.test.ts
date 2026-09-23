import { describe, expect, it } from "vitest";
import type { Yoga } from "yoga-layout/load";
import { createJsxState } from "../../jsx/state";
import { readTree } from "../../jsx/tree";
import type { Element } from "../../jsx/types";
import { layoutChanged } from "../../layout/apply";
import { dimRects, readTarget } from "../../layout/guide";
import { clampToMode, contentOf, needsMeasure } from "../../layout/measure";
import { restTransform } from "../../layout/motion";
import { readPayload } from "../../layout/popup";
import { clampOffset } from "../../layout/scroll";

/**
 * Builds the smallest element the pure readers need.
 *
 * @param patch - What to change about it.
 * @returns The element.
 */
function elementOf(patch: Partial<Element> = {}): Element {
  return {
    entity: 1,
    identity: "0|text@0|text",
    type: "text",
    key: "coins",
    parentType: "row",
    root: 0,
    node: { type: "text", props: {}, children: [] },
    style: {},
    is: {
      pressed: false,
      hover: false,
      disabled: false,
      active: false,
      selected: false,
      covered: false
    },
    rect: { x: 0, y: 0, w: 0, h: 0 },
    previous: { x: 0, y: 0, w: 0, h: 0 },
    moved: false,
    fit: 1,
    rest: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
    handles: [],
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

// ─── tree ─────────────────────────────────────────────────────

describe("tree", () => {
  it("answers an empty screen when nothing is mounted", () => {
    expect(readTree(createJsxState())).toEqual({
      key: undefined,
      type: "screen",
      rect: { x: 0, y: 0, w: 0, h: 0 },
      style: {},
      state: {
        pressed: false,
        hover: false,
        disabled: false,
        active: false,
        selected: false,
        covered: false
      },
      children: []
    });
  });
});

// ─── the layout change test ───────────────────────────────────

describe("layoutChanged", () => {
  it("is true for a field that reaches Yoga and false for a visual one", () => {
    expect(layoutChanged({ gap: 8 }, { gap: 12 })).toBe(true);
    expect(layoutChanged({ padding: { top: 4 } }, { padding: { top: 8 } })).toBe(true);
    expect(layoutChanged({ gap: 8, fill: 1 }, { gap: 8, fill: 2 })).toBe(false);
  });
});

// ─── measure ──────────────────────────────────────────────────

describe("measure", () => {
  it("gives a text with a fixed width and height no measure function", () => {
    expect(needsMeasure(elementOf({ style: { width: 200, height: 40 } }))).toBe(false);
    expect(needsMeasure(elementOf({ style: { width: "auto", height: 40 } }))).toBe(true);
    expect(needsMeasure(elementOf({ type: "row" }))).toBe(false);
  });

  it("reads the content and the style key of a text", () => {
    const element = elementOf({
      node: { type: "text", props: { content: "120", style: "digits" }, children: [] }
    });

    expect(contentOf(element)).toEqual({ content: "120", style: "digits" });
    expect(contentOf(elementOf()).style).toBe("body");
  });

  it("clamps the measured size to the mode Yoga asked in", () => {
    const yoga = { MEASURE_MODE_EXACTLY: 1, MEASURE_MODE_AT_MOST: 2 } as unknown as Yoga;
    const measured = { width: 120, height: 40 };

    expect(
      clampToMode(yoga, measured, { width: 80, widthMode: 1, height: 20, heightMode: 0 })
    ).toEqual({ width: 80, height: 40 });
    expect(
      clampToMode(yoga, measured, { width: 80, widthMode: 2, height: 100, heightMode: 2 })
    ).toEqual({ width: 80, height: 40 });
  });
});

// ─── the rest pose ────────────────────────────────────────────

describe("restTransform", () => {
  it("is the rect of a root element and the offset of a child, plus the centre pivot", () => {
    expect(restTransform({ x: 40, y: 80, w: 10, h: 10 }, undefined)).toEqual({
      x: 45,
      y: 85,
      rotation: 0,
      scale: 1,
      pivot: { x: 5, y: 5 }
    });
    expect(restTransform({ x: 40, y: 80, w: 10, h: 10 }, { x: 10, y: 20, w: 0, h: 0 })).toEqual({
      x: 35,
      y: 65,
      rotation: 0,
      scale: 1,
      pivot: { x: 5, y: 5 }
    });
  });
});

// ─── scroll, popup and guide payloads ─────────────────────────

describe("the pure payload readers", () => {
  it("keeps a scroll offset inside its range", () => {
    expect(clampOffset(40, -300)).toBe(0);
    expect(clampOffset(-400, -300)).toBe(-300);
    expect(clampOffset(-120, -300)).toBe(-120);
  });

  it("reads the component and props of a popup descriptor", () => {
    expect(readPayload({ component: "Reward", props: { gold: 5 } })).toEqual({
      component: "Reward",
      props: { gold: 5 }
    });
    expect(readPayload(undefined)).toEqual({ component: "", props: {} });
  });

  it("reads the target of a guide descriptor", () => {
    expect(readTarget({ target: { projection: "hud", key: "play" } })?.key).toBe("play");
    expect(readTarget({ allow: { intent: "ok" } })).toBeUndefined();
  });

  it("cuts four rectangles around a hole and one without a target", () => {
    const screen = { x: 0, y: 0, w: 100, h: 100 };

    expect(dimRects(screen, undefined)).toEqual([screen]);
    expect(dimRects(screen, { x: 40, y: 40, w: 20, h: 20 })).toEqual([
      { x: 0, y: 0, w: 100, h: 40 },
      { x: 0, y: 60, w: 100, h: 40 },
      { x: 0, y: 40, w: 40, h: 20 },
      { x: 60, y: 40, w: 40, h: 20 }
    ]);
  });
});
