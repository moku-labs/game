import { beforeAll, describe, expect, it } from "vitest";
import type { Yoga } from "yoga-layout/load";
import { bind } from "../../../text/components";
import { component } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import type { Element } from "../../jsx/types";
import { installMeasure, remeasureShown, shownOf } from "../../layout/measure";
import { createLayoutState } from "../../layout/state";
import type { LayoutState, TextSource } from "../../layout/types";
import { loadYogaModule } from "../../layout/yoga";

// ---------------------------------------------------------------------------
// Unit: a text with `bind` is measured by the string it shows (14-ui Delta 10
// Part A, design §1). Real Yoga, a fake `text`: 10 units per character.
// ---------------------------------------------------------------------------

/** A game's own counter, as the fixture's `Counter` is. */
const Tally = component("Tally", { value: 0 });

/** The entity of the text under test. */
const LABEL: Entity = 7;

let yoga: Yoga;

beforeAll(async () => {
  yoga = await loadYogaModule();
});

/**
 * A fake `text` and `i18n`: every character is 10 wide and 20 tall, `resolved` comes from a map
 * the test writes, and a duration reads as whole seconds.
 *
 * @param resolved - The string `text` resolved per entity; none before the first resolve.
 * @returns The source the measure function reads.
 */
function sourceOf(resolved: Map<Entity, string>): TextSource {
  return {
    measure: content => ({
      width: typeof content === "string" ? content.length * 10 : 0,
      height: 20
    }),
    resolved: entity => resolved.get(entity),
    duration: ms => `${ms / 1000}s`
  };
}

/**
 * Builds a text element with the props the markup wrote.
 *
 * @param props - The props of the text.
 * @returns The element.
 */
function textElement(props: Record<string, unknown>): Element {
  return {
    entity: LABEL,
    identity: "0|label|text",
    type: "text",
    key: "label",
    parentType: "row",
    root: 0,
    node: { type: "text", key: "label", props, children: [] },
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
    rect: { x: 0, y: 0, w: 0, h: 0 },
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
    extras: new Map(),
    extraHandles: new Map(),
    warnedOwned: new Set(),
    warned: new Set(),
    scrolledIn: false
  };
}

/**
 * Puts the node of a text into a 300-wide row that centres it, with its measure function.
 *
 * @param element - The text element.
 * @param source - What it is measured through.
 * @returns The layout state, the row and the node of the text.
 */
function centredText(element: Element, source: TextSource) {
  const state: LayoutState = { ...createLayoutState(), yoga };
  const row = yoga.Node.create();
  const node = yoga.Node.create();

  row.setWidth(300);
  row.setHeight(60);
  row.setFlexDirection(yoga.FLEX_DIRECTION_ROW);
  row.setJustifyContent(yoga.JUSTIFY_CENTER);
  row.setAlignItems(yoga.ALIGN_CENTER);
  row.insertChild(node, 0);
  state.byEntity.set(element.entity, node);
  installMeasure(state, node, element, source);

  return { state, row, node };
}

/**
 * Solves the row and reads where the text sits in it.
 *
 * @param row - The row node.
 * @param node - The node of the text.
 * @returns The left edge and the width of the text.
 */
function solved(row: ReturnType<Yoga["Node"]["create"]>, node: ReturnType<Yoga["Node"]["create"]>) {
  row.calculateLayout(300, 60, yoga.DIRECTION_LTR);

  return { x: node.getComputedLeft(), w: node.getComputedWidth() };
}

describe("shownOf", () => {
  it("is the bound field of the components value, formatted, before the first resolve", () => {
    const source = sourceOf(new Map());
    const rounded = textElement({
      bind: bind(Tally, "value"),
      components: [Tally({ value: 9.4 })]
    });
    const timer = textElement({
      bind: bind(Tally, "value", { format: "mm:ss" }),
      components: [Tally({ value: 95_000 })]
    });
    const words = textElement({
      bind: bind(Tally, "value", { format: "duration" }),
      components: [Tally({ value: 95_000 })]
    });

    expect(shownOf(rounded, source)).toBe("9");
    expect(shownOf(timer, source)).toBe("01:35");
    expect(shownOf(words, source)).toBe("95s");
  });

  it("takes the last value of the bound component, as the element does", () => {
    const element = textElement({
      bind: bind(Tally, "value"),
      components: [Tally({ value: 3 }), Tally({ value: 120 })]
    });

    expect(shownOf(element, sourceOf(new Map()))).toBe("120");
  });

  it("is empty without a value of the bound component; a number that is not finite shows 0, as text shows it", () => {
    const source = sourceOf(new Map());

    expect(shownOf(textElement({ bind: bind(Tally, "value") }), source)).toBe("");
    expect(
      shownOf(
        textElement({ bind: bind(Tally, "value"), components: [Tally({ value: Number.NaN })] }),
        source
      )
    ).toBe("0");
  });

  it("is the string text resolved once the entity carries its Text, an empty one too", () => {
    const element = textElement({ bind: bind(Tally, "value"), components: [Tally({ value: 9 })] });

    expect(shownOf(element, sourceOf(new Map([[LABEL, "1250"]])))).toBe("1250");
    expect(shownOf(element, sourceOf(new Map([[LABEL, ""]])))).toBe("");
  });

  it("is undefined for a text with no bind", () => {
    expect(shownOf(textElement({ content: "Play" }), sourceOf(new Map()))).toBeUndefined();
  });
});

describe("the measure function of a bound text", () => {
  it("sizes the text by the string it shows, so the row centres it like a content text", () => {
    const bound = textElement({
      style: "digits",
      bind: bind(Tally, "value"),
      components: [Tally({ value: 9 })]
    });
    const plain = textElement({ style: "digits", content: "9" });
    const boundRow = centredText(bound, sourceOf(new Map()));
    const plainRow = centredText(plain, sourceOf(new Map()));

    expect(solved(boundRow.row, boundRow.node)).toEqual({ x: 145, w: 10 });
    expect(solved(plainRow.row, plainRow.node)).toEqual({ x: 145, w: 10 });
  });

  it("re-measures when the shown string measures differently, and only then", () => {
    const resolved = new Map<Entity, string>();
    const source = sourceOf(resolved);
    const element = textElement({ bind: bind(Tally, "value"), components: [Tally({ value: 9 })] });
    const { state, row, node } = centredText(element, source);

    expect(solved(row, node)).toEqual({ x: 145, w: 10 });

    // text resolves what ui already measured: nothing to do.
    resolved.set(LABEL, "9");

    expect(remeasureShown(state, element, source)).toBe(false);
    expect(node.isDirty()).toBe(false);

    // "9" becomes "10": one character wider, the node is dirty and grows around the centre.
    resolved.set(LABEL, "10");

    expect(remeasureShown(state, element, source)).toBe(true);
    expect(node.isDirty()).toBe(true);
    expect(solved(row, node)).toEqual({ x: 140, w: 20 });

    // "10" becomes "11": the same width, so no solve is asked for.
    resolved.set(LABEL, "11");

    expect(remeasureShown(state, element, source)).toBe(false);
    expect(node.isDirty()).toBe(false);
  });

  it("leaves a content text and a text never measured alone", () => {
    const source = sourceOf(new Map([[LABEL, "Play again"]]));
    const plain = textElement({ content: "Play" });
    const { state, row, node } = centredText(plain, source);

    solved(row, node);

    expect(remeasureShown(state, plain, source)).toBe(false);
    expect(node.isDirty()).toBe(false);

    const fresh = textElement({ bind: bind(Tally, "value"), components: [Tally({ value: 9 })] });

    expect(remeasureShown(centredText(fresh, source).state, fresh, source)).toBe(false);
  });

  it("leaves a bound text with a fixed size alone: its node has no measure function", () => {
    const resolved = new Map<Entity, string>([[LABEL, "9"]]);
    const source = sourceOf(resolved);
    const element = textElement({ bind: bind(Tally, "value"), components: [Tally({ value: 9 })] });
    const { state, row, node } = centredText(element, source);

    solved(row, node);
    element.style = { width: 80, height: 40 };
    installMeasure(state, node, element, source);
    resolved.set(LABEL, "10");

    expect(remeasureShown(state, element, source)).toBe(false);
  });
});
