import { describe, expect, it } from "vitest";
import { createJsxState } from "../../jsx/state";
import { readTree } from "../../jsx/tree";
import type { Element, JsxState, ScrollMotion, UiNode } from "../../jsx/types";
import { stopsOf } from "../../layout/scroll";

// ---------------------------------------------------------------------------
// `readTree` over a hand-built state: the `content` of a text node comes from
// the string `text` resolved for its entity, else from a plain `content` prop.
// ---------------------------------------------------------------------------

/**
 * Builds one element record.
 *
 * @param patch - What to change about it.
 * @returns The element.
 */
function elementOf(patch: Partial<Element>): Element {
  return {
    entity: 1,
    identity: "0|label@0|text",
    type: "text",
    key: "label",
    parentType: undefined,
    root: 1,
    node: { type: "text", props: {}, children: [] },
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
    rect: { x: 0, y: 0, w: 100, h: 40 },
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
    live: true,
    entered: true,
    dropKey: undefined,
    extras: new Map(),
    extraHandles: new Map(),
    warnedOwned: new Set(),
    warned: new Set(),
    index: 0,
    cause: "change",
    rebuilds: 0,
    scrolledIn: false,
    ...patch
  };
}

/**
 * A state with one mounted root whose root element is the given element.
 *
 * @param element - The root element.
 * @returns The state.
 */
function stateWith(element: Element): JsxState {
  const state = createJsxState();

  state.elements.set(element.entity, element);
  state.roots.set(element.entity, {
    entity: element.entity,
    name: "hud",
    tree: element.node,
    layer: "ui",
    order: 0,
    dirty: false,
    needsSolve: false,
    element: element.entity,
    popup: undefined,
    covered: false,
    cause: undefined,
    slot: undefined,
    slotRect: undefined
  });

  return state;
}

describe("readTree content", () => {
  it("gives a text node the string text resolved for its entity", () => {
    const element = elementOf({
      node: { type: "text", props: { content: { key: "home.title" } }, children: [] }
    });
    const tree = readTree(stateWith(element), ["ui"], entity =>
      entity === 1 ? "Лесной городок" : undefined
    );

    expect(tree.content).toBe("Лесной городок");
  });

  it("drops the tags of the resolved string and keeps its text", () => {
    const element = elementOf({});
    const tree = readTree(
      stateWith(element),
      ["ui"],
      () => String.raw`<b>+5</b> <icon=hud.coin>\<3`
    );

    expect(tree.content).toBe("+5 <3");
  });

  it("falls back to a plain content prop before text resolved the label", () => {
    const element = elementOf({
      node: { type: "text", props: { content: "Play" }, children: [] }
    });

    expect(readTree(stateWith(element), ["ui"], () => "").content).toBe("Play");
    expect(readTree(stateWith(element), ["ui"]).content).toBe("Play");
  });

  it("has no content key for a text with nothing to show", () => {
    const message = elementOf({
      node: { type: "text", props: { content: { key: "home.title" } }, children: [] }
    });
    const empty = elementOf({ node: { type: "text", props: { content: "" }, children: [] } });

    expect(Object.hasOwn(readTree(stateWith(message), ["ui"]), "content")).toBe(false);
    expect(
      Object.hasOwn(
        readTree(stateWith(empty), ["ui"], () => ""),
        "content"
      )
    ).toBe(false);
  });

  it("has no content key on a node that is not a text", () => {
    const row = elementOf({
      type: "row",
      key: "bar",
      node: { type: "row", props: { content: "not a label" }, children: [] }
    });
    const tree = readTree(stateWith(row), ["ui"], () => "resolved");

    expect(Object.hasOwn(tree, "content")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// `readTree` over a hand-built state: the `textStyle` of a text node is its
// `style` prop while that is a text style key, and is left off anything else.
// ---------------------------------------------------------------------------

describe("readTree textStyle", () => {
  it("gives a text given a style key that key", () => {
    const label = elementOf({
      entity: 2,
      key: "homePlayLabel",
      parent: 1,
      node: { type: "text", props: { style: "ui.button", content: "Play" }, children: [] }
    });
    const row = elementOf({
      type: "row",
      key: "home",
      node: { type: "row", props: {}, children: [] },
      children: [2]
    });
    const state = stateWith(row);

    state.elements.set(label.entity, label);

    const found = readTree(state, ["ui"]).children.find(node => node.key === "homePlayLabel");

    expect(found?.textStyle).toBe("ui.button");
  });

  it("has no textStyle key for a text with a Style object or none, and on a node that is not a text", () => {
    const sized = elementOf({
      node: { type: "text", props: { style: { width: 100, height: 40 } }, children: [] }
    });
    const bare = elementOf({});
    const row = elementOf({
      type: "row",
      key: "bar",
      node: { type: "row", props: { style: "ui.button" }, children: [] }
    });

    expect(Object.hasOwn(readTree(stateWith(sized), ["ui"]), "textStyle")).toBe(false);
    expect(Object.hasOwn(readTree(stateWith(bare), ["ui"]), "textStyle")).toBe(false);
    expect(Object.hasOwn(readTree(stateWith(row), ["ui"]), "textStyle")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// `readTree` over a hand-built state: the `motion` id and the `scroll` record
// (F192, F193) are read off the element, with no world.
// ---------------------------------------------------------------------------

/**
 * A scroll motion as the solve leaves it.
 *
 * @param patch - What to change about it.
 * @returns The motion.
 */
function motionOf(patch: Partial<ScrollMotion>): ScrollMotion {
  return {
    axis: "x",
    mode: "still",
    offset: 0,
    max: 390,
    velocity: 0,
    from: 0,
    to: 0,
    duration: 0,
    elapsed: 0,
    pointer: 0,
    start: 0,
    seen: 0,
    aim: undefined,
    glideMs: Number.NaN,
    locked: false,
    placed: true,
    atProp: true,
    ...patch
  };
}

/**
 * The scroll element of a strip.
 *
 * @param scroll - Its motion record.
 * @param props - Its props.
 * @returns The element.
 */
function stripOf(scroll: ScrollMotion | undefined, props: Record<string, unknown>): Element {
  return elementOf({
    type: "scroll",
    key: "strip",
    node: { type: "scroll", props, children: [] },
    ...(scroll === undefined ? {} : { scroll })
  });
}

/**
 * Reads the tree the way the module does, with the stops of the layout module.
 *
 * @param state - The state to read.
 * @returns The root node.
 */
function withStops(state: JsxState): UiNode {
  return readTree(state, ["ui"], undefined, undefined, undefined, undefined, stopsOf);
}

describe("readTree scroll", () => {
  it("gives a scroll its axis, rounded offset, max and moving flag, and the stops it snaps to", () => {
    // Bug caught: the offset is read unrounded, or `moving` ignores a glide, or the stops are dropped.
    const gliding = motionOf({ offset: 317.6, mode: "glide" });
    const tree = withStops(stateWith(stripOf(gliding, { snap: [0, 318, 390] })));

    expect(tree.scroll).toEqual({
      axis: "x",
      offset: 318,
      max: 390,
      moving: true,
      snap: [0, 318, 390]
    });
  });

  it("says a standing scroll does not move", () => {
    // Bug caught: `moving` is true for every mode, so a still strip reads as animating.
    const tree = withStops(stateWith(stripOf(motionOf({ mode: "still" }), {})));

    expect(tree.scroll?.moving).toBe(false);
  });

  it("is all zeros and not moving before the first solve placed it", () => {
    // Bug caught: the tree shows the unplaced record's leftover numbers, not what ScrollState says.
    const unplaced = motionOf({ placed: false, offset: 12, max: 77, mode: "glide", axis: "y" });
    const tree = withStops(stateWith(stripOf(unplaced, {})));

    expect(tree.scroll).toEqual({ axis: "y", offset: 0, max: 0, moving: false });
  });

  it("clamps the stops into 0 to max and drops what is no finite number, in prop order", () => {
    // Bug caught: a stop outside the range, a NaN (null in JSON) or a word reaches the reader.
    const clamped = withStops(stateWith(stripOf(motionOf({}), { snap: [-10, 500] })));
    const mixed = withStops(
      stateWith(
        stripOf(motionOf({}), { snap: [300, "end", Number.NaN, Number.POSITIVE_INFINITY, 100] })
      )
    );

    expect(clamped.scroll?.snap).toEqual([0, 390]);
    expect(mixed.scroll?.snap).toEqual([300, 100]);
  });

  it("has no snap key without the prop, with an empty one or with no finite stop", () => {
    // Bug caught: `snap: []` or `snap: undefined` shows up for a scroll that names no stops.
    for (const snap of [undefined, [], ["a"], [Number.NaN], "0,318", 5]) {
      const tree = withStops(stateWith(stripOf(motionOf({}), { snap })));

      expect(tree.scroll).toBeDefined();
      expect(Object.hasOwn(tree.scroll ?? {}, "snap")).toBe(false);
    }
  });

  it("has no scroll key on an element without a scroll record", () => {
    // Bug caught: every node, a text or a row, would carry a scroll record.
    const row = elementOf({
      type: "row",
      key: "bar",
      node: { type: "row", props: {}, children: [] }
    });

    expect(Object.hasOwn(withStops(stateWith(row)), "scroll")).toBe(false);
    expect(Object.hasOwn(withStops(stateWith(stripOf(undefined, {}))), "scroll")).toBe(false);
  });
});

describe("readTree motion", () => {
  it("gives an element the id of its motion prop", () => {
    // Bug caught: the id is read from the wrong place and a labelled motion shows nothing.
    const card = elementOf({
      type: "column",
      key: "card",
      node: {
        type: "column",
        props: { motion: { id: "hud.card", enter: () => undefined } },
        children: []
      }
    });

    expect(readTree(stateWith(card)).motion).toBe("hud.card");
  });

  it("has no motion key without a motion, with a motion that has no id, or an id that is no string", () => {
    // Bug caught: `motion: undefined` or a number id is shown for an element the id does not name.
    for (const props of [{}, { motion: {} }, { motion: { id: 7 } }, { motion: "hud.card" }]) {
      const card = elementOf({ type: "column", node: { type: "column", props, children: [] } });

      expect(Object.hasOwn(readTree(stateWith(card)), "motion")).toBe(false);
    }
  });
});

describe("stopsOf", () => {
  it("keeps the finite numbers inside 0 to max, in order, and answers nothing for the rest", () => {
    // Bug caught: the reader's stops differ from the ones a release snaps to.
    expect(stopsOf([-10, 318, 500], 390)).toEqual([0, 318, 390]);
    expect(stopsOf([], 390)).toBeUndefined();
    expect(stopsOf(undefined, 390)).toBeUndefined();
  });
});
