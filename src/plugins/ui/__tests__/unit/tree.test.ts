import { describe, expect, it } from "vitest";
import { createJsxState } from "../../jsx/state";
import { readTree } from "../../jsx/tree";
import type { Element, JsxState } from "../../jsx/types";

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
    covered: false
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
