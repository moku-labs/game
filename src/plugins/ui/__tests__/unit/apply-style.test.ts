import { describe, expect, it } from "vitest";
import type { Yoga, Node as YogaNode } from "yoga-layout/load";
import type { Element } from "../../jsx/types";
import { applyStyleToNode, keepSize, layoutChanged } from "../../layout/apply";
import { createNode, freeNode, freeSpare, SPARE_LIMIT } from "../../layout/nodes";
import { createLayoutState } from "../../layout/state";
import type { LayoutState } from "../../layout/types";
import { loadYogaModule } from "../../layout/yoga";
import type { Extent, ResolvedStyle } from "../../styles/types";

// ---------------------------------------------------------------------------
// The reference: `applyFlow`, `applyBox` and `applyPosition` as they stood before change
// 2026-11-24-f230-hot-path (U1), copied here. They call every setter on every write; the code under
// test skips a setter whose value the node's kept record holds. Every Yoga getter of a node written by
// the code under test must equal the getter of a node written by this copy.
// ---------------------------------------------------------------------------

/**
 * Reads one edge of a padding or margin (the reference copy).
 *
 * @param edges - What the resolved style carries.
 * @param side - The edge to read.
 * @returns The number, or `undefined`.
 */
function edgeOf(
  edges: ResolvedStyle["padding"],
  side: "top" | "right" | "bottom" | "left"
): number | undefined {
  if (edges === undefined) return undefined;
  if (typeof edges === "number") return edges;

  return edges[side];
}

/**
 * The flow group, as written before the change.
 *
 * @param yoga - The loaded Yoga module.
 * @param node - The node.
 * @param style - The resolved style.
 * @param column - Whether the tag lays its children out in a column.
 */
function referenceFlow(yoga: Yoga, node: YogaNode, style: ResolvedStyle, column: boolean): void {
  const direction = style.direction ?? (column ? "column" : "row");

  node.setFlexDirection(direction === "row" ? yoga.FLEX_DIRECTION_ROW : yoga.FLEX_DIRECTION_COLUMN);
  node.setFlexWrap(style.wrap === true ? yoga.WRAP_WRAP : yoga.WRAP_NO_WRAP);
  node.setJustifyContent(
    {
      start: yoga.JUSTIFY_FLEX_START,
      center: yoga.JUSTIFY_CENTER,
      end: yoga.JUSTIFY_FLEX_END,
      between: yoga.JUSTIFY_SPACE_BETWEEN,
      around: yoga.JUSTIFY_SPACE_AROUND,
      evenly: yoga.JUSTIFY_SPACE_EVENLY
    }[style.justify ?? "start"]
  );
  node.setAlignItems(
    {
      start: yoga.ALIGN_FLEX_START,
      center: yoga.ALIGN_CENTER,
      end: yoga.ALIGN_FLEX_END,
      stretch: yoga.ALIGN_STRETCH
    }[style.align ?? "stretch"]
  );
  node.setAlignSelf(
    {
      auto: yoga.ALIGN_AUTO,
      start: yoga.ALIGN_FLEX_START,
      center: yoga.ALIGN_CENTER,
      end: yoga.ALIGN_FLEX_END,
      stretch: yoga.ALIGN_STRETCH
    }[style.alignSelf ?? "auto"]
  );
  node.setGap(yoga.GUTTER_ALL, style.gap ?? 0);
  node.setFlexGrow(style.grow ?? 0);
  node.setFlexShrink(style.shrink ?? 0);
}

/**
 * One extent, as written before the change.
 *
 * @param node - The node.
 * @param field - Which extent is written.
 * @param value - What the style carries.
 */
function referenceExtent(
  node: YogaNode,
  field: "width" | "height" | "minWidth" | "minHeight" | "maxWidth" | "maxHeight",
  value: Extent | undefined
): void {
  if (value === undefined) return;

  if (field === "width") node.setWidth(value);
  else if (field === "height") node.setHeight(value);
  else if (value !== "auto") {
    switch (field) {
      case "minWidth": {
        node.setMinWidth(value);
        break;
      }
      case "minHeight": {
        node.setMinHeight(value);
        break;
      }
      case "maxWidth": {
        node.setMaxWidth(value);
        break;
      }
      default: {
        node.setMaxHeight(value);
      }
    }
  }
}

/**
 * The box group, as written before the change.
 *
 * @param yoga - The loaded Yoga module.
 * @param node - The node.
 * @param style - The resolved style.
 */
function referenceBox(yoga: Yoga, node: YogaNode, style: ResolvedStyle): void {
  const edges = [
    ["top", yoga.EDGE_TOP],
    ["right", yoga.EDGE_RIGHT],
    ["bottom", yoga.EDGE_BOTTOM],
    ["left", yoga.EDGE_LEFT]
  ] as const;

  for (const [name, which] of edges) {
    node.setPadding(which, edgeOf(style.padding, name));
    node.setMargin(which, edgeOf(style.margin, name));
  }

  referenceExtent(node, "width", style.width);
  referenceExtent(node, "height", style.height);
  referenceExtent(node, "minWidth", style.minWidth);
  referenceExtent(node, "minHeight", style.minHeight);
  referenceExtent(node, "maxWidth", style.maxWidth);
  referenceExtent(node, "maxHeight", style.maxHeight);
  node.setAspectRatio(style.aspect);
  node.setOverflow(
    { visible: yoga.OVERFLOW_VISIBLE, hidden: yoga.OVERFLOW_HIDDEN, scroll: yoga.OVERFLOW_SCROLL }[
      style.overflow ?? "visible"
    ]
  );
}

/**
 * The position group, as written before the change.
 *
 * @param yoga - The loaded Yoga module.
 * @param node - The node.
 * @param style - The resolved style.
 * @param stacked - Whether the parent tag is a `stack`.
 */
function referencePosition(
  yoga: Yoga,
  node: YogaNode,
  style: ResolvedStyle,
  stacked: boolean
): void {
  const absolute =
    style.position === "absolute" ||
    style.fit === "contain" ||
    (stacked && style.position === undefined);

  node.setPositionType(absolute ? yoga.POSITION_TYPE_ABSOLUTE : yoga.POSITION_TYPE_RELATIVE);
  node.setPosition(yoga.EDGE_LEFT, style.left);
  node.setPosition(yoga.EDGE_TOP, style.top);
  node.setPosition(yoga.EDGE_RIGHT, style.right);
  node.setPosition(yoga.EDGE_BOTTOM, style.bottom);
}

/**
 * One write of the reference.
 *
 * @param yoga - The loaded Yoga module.
 * @param node - The node.
 * @param write - The style and the two tags.
 */
function referenceWrite(yoga: Yoga, node: YogaNode, write: Write): void {
  referenceFlow(yoga, node, write.style, write.tag !== "row");
  referenceBox(yoga, node, write.style);
  referencePosition(yoga, node, write.style, write.parentTag === "stack");
}

// ---------------------------------------------------------------------------

/** One style write: the style, the element's tag and its parent's. */
type Write = { style: ResolvedStyle; tag: string; parentTag: string | undefined };

/** Resolved styles that cover every field, every enum word, the three extent kinds and unset edges. */
const STYLES: readonly ResolvedStyle[] = [
  {},
  { direction: "row" },
  { direction: "column" },
  { wrap: true },
  { wrap: false },
  { justify: "start" },
  { justify: "center" },
  { justify: "end" },
  { justify: "between" },
  { justify: "around" },
  { justify: "evenly" },
  { align: "start" },
  { align: "center" },
  { align: "end" },
  { align: "stretch" },
  { alignSelf: "auto" },
  { alignSelf: "start" },
  { alignSelf: "center" },
  { alignSelf: "end" },
  { alignSelf: "stretch" },
  { gap: 12 },
  { gap: 0 },
  { grow: 1, shrink: 1 },
  { grow: 0.5, shrink: 0 },
  { padding: 8 },
  { padding: { top: 4, left: 16.5 } },
  { padding: { right: 2, bottom: 3 } },
  { margin: 4 },
  { margin: { top: 1, bottom: 2 } },
  { margin: { left: 5, right: 6.25 } },
  { width: 100 },
  { width: "50%" },
  { width: "auto" },
  { height: 120 },
  { height: "25%", width: 100 },
  { height: "auto" },
  { minWidth: 40, minHeight: "10%" },
  { minWidth: "auto", minHeight: "auto" },
  { maxWidth: 600, maxHeight: "80%" },
  { maxWidth: "auto", maxHeight: 300 },
  { minWidth: "5%", maxWidth: "90%" },
  { aspect: 1.5 },
  { aspect: 2 },
  { overflow: "visible" },
  { overflow: "hidden" },
  { overflow: "scroll" },
  { position: "absolute", left: 10, top: 20 },
  { position: "relative", right: 5.5, bottom: 7 },
  { fit: "contain" },
  { left: 0, top: 0, right: 0, bottom: 0 },
  {
    direction: "row",
    wrap: true,
    justify: "between",
    align: "center",
    alignSelf: "end",
    gap: 12,
    grow: 1,
    shrink: 1,
    padding: { top: 8, left: 16.5 },
    margin: 4,
    width: "50%",
    height: 120,
    minWidth: 40,
    maxHeight: 600,
    aspect: 1.5,
    overflow: "hidden",
    position: "absolute",
    left: 10.5,
    top: 20
  },
  { width: 100, height: 50 }
];

/** Each style with a tag and a parent tag: a row, a column and a stack's child in turn. */
const WRITES: readonly Write[] = STYLES.map((style, index) => ({
  style,
  tag: index % 3 === 0 ? "row" : "column",
  parentTag: index % 2 === 1 ? "stack" : undefined
}));

/**
 * Every style getter of a node, Yoga values as `{ unit, value }`.
 *
 * @param yoga - The loaded Yoga module.
 * @param node - The node.
 * @returns The getters by name.
 */
function gettersOf(yoga: Yoga, node: YogaNode): Record<string, unknown> {
  const edges = {
    top: yoga.EDGE_TOP,
    right: yoga.EDGE_RIGHT,
    bottom: yoga.EDGE_BOTTOM,
    left: yoga.EDGE_LEFT
  };
  const read: Record<string, unknown> = {
    flexDirection: node.getFlexDirection(),
    flexWrap: node.getFlexWrap(),
    justifyContent: node.getJustifyContent(),
    alignItems: node.getAlignItems(),
    alignSelf: node.getAlignSelf(),
    gap: node.getGap(yoga.GUTTER_ALL),
    flexGrow: node.getFlexGrow(),
    flexShrink: node.getFlexShrink(),
    width: node.getWidth(),
    height: node.getHeight(),
    minWidth: node.getMinWidth(),
    minHeight: node.getMinHeight(),
    maxWidth: node.getMaxWidth(),
    maxHeight: node.getMaxHeight(),
    aspectRatio: node.getAspectRatio(),
    overflow: node.getOverflow(),
    positionType: node.getPositionType()
  };

  for (const [name, which] of Object.entries(edges)) {
    read[`padding.${name}`] = node.getPadding(which);
    read[`margin.${name}`] = node.getMargin(which);
    read[`position.${name}`] = node.getPosition(which);
  }

  return read;
}

/**
 * Makes the node of a new element the way `ui` does, with its kept record.
 *
 * @param state - The layout state, Yoga loaded.
 * @param entity - The element's entity.
 * @returns The node.
 */
function nodeOf(state: LayoutState, entity: number): YogaNode {
  const node = createNode(state, { entity } as Element);

  if (node === undefined) throw new Error("test: Yoga is not loaded");

  return node;
}

/**
 * One write of the code under test, through the node's kept record.
 *
 * @param state - The layout state.
 * @param node - The node.
 * @param write - The style and the two tags.
 */
function keptWrite(state: LayoutState, node: YogaNode, write: Write): void {
  if (state.yoga === undefined) throw new Error("test: Yoga is not loaded");

  applyStyleToNode(
    state.yoga,
    node,
    write.style,
    write.tag,
    write.parentTag,
    state.kept.get(node),
    state.tables
  );
}

/**
 * A layout state with Yoga loaded, as `ui`'s `onStart` leaves it.
 *
 * @returns The state and the module.
 */
async function loaded(): Promise<{ state: LayoutState; yoga: Yoga }> {
  const state = createLayoutState();
  const yoga = await loadYogaModule();

  state.yoga = yoga;

  return { state, yoga };
}

describe("a style write that skips what the node holds", () => {
  it("leaves every getter where the full write leaves it, over a sequence of styles on one node", async () => {
    // Bug caught: a value compared with the wrong kept slot or kind, so a write that changes it is
    // skipped and the node keeps an older width, edge, enum or position.
    const { state, yoga } = await loaded();
    const node = nodeOf(state, 1);
    const reference = yoga.Node.create();

    expect(WRITES.length).toBeGreaterThanOrEqual(40);

    for (const [index, write] of WRITES.entries()) {
      keptWrite(state, node, write);
      referenceWrite(yoga, reference, write);
      expect({ index, ...gettersOf(yoga, node) }).toEqual({ index, ...gettersOf(yoga, reference) });
    }

    // The same sequence backwards: every value is now left from another style than the first time.
    for (const [index, write] of WRITES.toReversed().entries()) {
      keptWrite(state, node, write);
      referenceWrite(yoga, reference, write);
      expect({ index, ...gettersOf(yoga, node) }).toEqual({ index, ...gettersOf(yoga, reference) });
    }

    reference.free();
  });

  it("leaves every getter where the full write leaves it, each style on a fresh node", async () => {
    // Bug caught: a kept record that does not hold what a fresh node holds, so the first write of
    // a value skips it as if it were there.
    const { state, yoga } = await loaded();

    for (const [index, write] of WRITES.entries()) {
      const node = nodeOf(state, 100 + index);
      const reference = yoga.Node.create();

      keptWrite(state, node, write);
      referenceWrite(yoga, reference, write);
      expect({ index, ...gettersOf(yoga, node) }).toEqual({ index, ...gettersOf(yoga, reference) });
      reference.free();
    }
  });

  it("writes a width and a height again after the anchor pass sized the node between two equal writes", async () => {
    // Bug caught: the anchor's own size write is not noted, so the second style write is skipped and
    // the node keeps the anchor's size instead of the style's.
    const { state, yoga } = await loaded();
    const node = nodeOf(state, 1);
    const reference = yoga.Node.create();
    const write: Write = { style: { width: 100, height: 50 }, tag: "column", parentTag: undefined };

    keptWrite(state, node, write);
    referenceWrite(yoga, reference, write);
    // What the anchor pass does with the rect of its targets.
    node.setWidth(116);
    node.setHeight(120);
    keepSize(state.kept.get(node), { w: 116, h: 120 });
    reference.setWidth(116);
    reference.setHeight(120);
    keptWrite(state, node, write);
    referenceWrite(yoga, reference, write);

    expect(gettersOf(yoga, node)).toEqual(gettersOf(yoga, reference));
    expect(node.getWidth().value).toBe(100);
    reference.free();
  });

  it("starts a node made again after a free from what a fresh node holds", async () => {
    // Bug caught: a kept record shared with the fresh values or left behind by the free, so the new
    // node of the entity believes it holds what the old one was written with.
    const { state, yoga } = await loaded();
    const write: Write = {
      style: { width: 100, padding: 8, grow: 1 },
      tag: "column",
      parentTag: undefined
    };

    keptWrite(state, nodeOf(state, 1), write);
    freeNode(state, { entity: 1 } as Element);
    expect(state.kept.size).toBe(0);

    const again = nodeOf(state, 1);
    const reference = yoga.Node.create();

    keptWrite(state, again, write);
    referenceWrite(yoga, reference, write);

    expect(gettersOf(yoga, again)).toEqual(gettersOf(yoga, reference));
    reference.free();
  });
});

describe("the spare nodes: a freed node taken back by the next element (hp-2ab)", () => {
  it("hands the next element the node the last free put aside, and makes no new one", async () => {
    // Bug caught: the spare is filled and never read, so every element still pays `Node.create` and a kept record.
    const { state, yoga } = await loaded();
    const first = nodeOf(state, 1);
    let made = 0;
    const create = yoga.Node.create.bind(yoga.Node);

    yoga.Node.create = (...rest: Parameters<typeof create>) => {
      made += 1;

      return create(...rest);
    };
    freeNode(state, { entity: 1 } as Element);

    const second = nodeOf(state, 2);

    yoga.Node.create = create;
    expect(second).toBe(first);
    expect(made).toBe(0);
    expect(state.spare.length).toBe(0);
    expect(state.nodes).toBe(1);
  });

  it("leaves every getter of a taken-back node where a fresh node written with the same style leaves it", async () => {
    // Bug caught: a taken-back node keeps what its last element wrote where the next style writes nothing (a
    // width, a min or max extent the next style leaves out): the next element lays out at the old element's size.
    const { state, yoga } = await loaded();

    for (const [index, write] of WRITES.entries()) {
      const before = WRITES[(index + 7) % WRITES.length] as Write;

      keptWrite(state, nodeOf(state, 1), before);
      freeNode(state, { entity: 1 } as Element);

      const again = nodeOf(state, 1);
      const reference = yoga.Node.create();

      keptWrite(state, again, write);
      referenceWrite(yoga, reference, write);
      expect({ index, ...gettersOf(yoga, again) }).toEqual({
        index,
        ...gettersOf(yoga, reference)
      });
      reference.free();
      freeNode(state, { entity: 1 } as Element);
    }
  });

  it("takes back a node with no children and lays it out with its new measure, not the size cached for the old one", async () => {
    // Bug caught: a freed parent keeps its children in the spare, or a measured node serves the size Yoga cached for
    // the element that freed it.
    const { state, yoga } = await loaded();
    const root = yoga.Node.create();

    // A child keeps its own width only where the root does not stretch it.
    root.setAlignItems(yoga.ALIGN_FLEX_START);

    const parent = nodeOf(state, 1);
    const child = nodeOf(state, 2);

    // The parent goes while it still holds its child, as a window closes with its rows.
    parent.insertChild(child, 0);
    freeNode(state, { entity: 1 } as Element);
    expect(state.spare.length).toBe(1);

    const reused = nodeOf(state, 3);

    expect(reused).toBe(parent);
    expect(reused.getChildCount()).toBe(0);
    expect(child.getParent()).toBeNull();

    reused.setMeasureFunc(() => ({ width: 50, height: 10 }));
    state.measuring.set(reused, { entity: 3 } as Element);
    root.insertChild(reused, 0);
    root.calculateLayout(1000, 1000, yoga.DIRECTION_LTR);
    expect(reused.getComputedWidth()).toBe(50);
    // eslint-disable-next-line unicorn/prefer-dom-node-remove -- a Yoga node is not a DOM node.
    root.removeChild(reused);
    freeNode(state, { entity: 3 } as Element);

    const measured = nodeOf(state, 4);

    expect(measured).toBe(reused);
    measured.setMeasureFunc(() => ({ width: 200, height: 10 }));
    root.insertChild(measured, 0);
    root.calculateLayout(1000, 1000, yoga.DIRECTION_LTR);
    expect(measured.getComputedWidth()).toBe(200);
    root.free();
  });

  it("measures again a node taken back that measured as a root, at the same size offered", async () => {
    // Bug caught: a measured node with no parent keeps the size Yoga cached for it (only a removal from a parent
    // drops that cache), so the next text laid out as a root at the same size gets the old text's width.
    const { state, yoga } = await loaded();
    const first = nodeOf(state, 1);

    first.setMeasureFunc(() => ({ width: 50, height: 10 }));
    state.measuring.set(first, { entity: 1 } as Element);
    first.calculateLayout(Number.NaN, Number.NaN, yoga.DIRECTION_LTR);
    expect(first.getComputedWidth()).toBe(50);
    freeNode(state, { entity: 1 } as Element);

    const again = nodeOf(state, 2);

    expect(again).toBe(first);
    again.setMeasureFunc(() => ({ width: 200, height: 10 }));
    again.calculateLayout(Number.NaN, Number.NaN, yoga.DIRECTION_LTR);
    expect(again.getComputedWidth()).toBe(200);
  });

  it(`frees a node once ${SPARE_LIMIT} are put aside, and frees the spare when ui stops`, async () => {
    // Bug caught: the spare grows without end after a window of thousands of rows, or holds nodes of a Yoga module
    // that a stop let go.
    const { state } = await loaded();

    for (let entity = 1; entity <= SPARE_LIMIT + 1; entity += 1) nodeOf(state, entity);
    for (let entity = 1; entity <= SPARE_LIMIT + 1; entity += 1)
      freeNode(state, { entity } as Element);

    expect(state.spare.length).toBe(SPARE_LIMIT);
    expect(state.spareKept.length).toBe(SPARE_LIMIT);

    let freed = 0;

    for (const node of state.spare) {
      const free = node.free.bind(node);

      node.free = () => {
        freed += 1;
        free();
      };
    }
    freeSpare(state);
    expect(freed).toBe(SPARE_LIMIT);
    expect(state.spare.length).toBe(0);
    expect(state.spareKept.length).toBe(0);
  });
});

describe("layoutChanged", () => {
  // Bug caught: the number fast path calls two widths that differ the same, or a style that dropped a field (read as 0)
  // the same as one that holds another value; or it parts values JSON reads alike (NaN and Infinity are both null).
  it("reads numbers as their JSON reads them, and an absent field as 0", () => {
    expect(layoutChanged({ width: 120 }, { width: 121 })).toBe(true);
    expect(layoutChanged({ width: 120 }, { width: 120 })).toBe(false);
    expect(layoutChanged({ width: 0 }, {})).toBe(false);
    expect(layoutChanged({ width: 8 }, {})).toBe(true);
    expect(layoutChanged({ width: -0 }, { width: 0 })).toBe(false);
    expect(layoutChanged({ width: Number.NaN }, { width: Number.POSITIVE_INFINITY })).toBe(false);
    expect(layoutChanged({ width: Number.NaN }, { width: 0 })).toBe(true);
    expect(layoutChanged({ width: "50%" }, { width: "50%" })).toBe(false);
    expect(layoutChanged({ width: "50%" }, { width: 50 })).toBe(true);
  });
});
