/**
 * @file ui/layout — the style vocabulary written onto a Yoga node, and the test that tells a
 * layout change from a visual one. Pure over the module Yoga hands out. A node `ui` made carries a
 * kept record of the Yoga-level values last written onto it, and a write calls a Yoga setter only
 * for a value that differs from the kept one (F230 U1): a setter of Yoga's wrapper allocates its
 * arguments, and an unchanged style is the common write.
 */
import type { Edge, Yoga, Node as YogaNode } from "yoga-layout/load";
import type { ResolvedStyle } from "../styles/types";
import type { KeptStyle, StyleTables } from "./types";

/** The fields that change a rect. A change outside this list is written to the visual only. */
const LAYOUT_FIELDS = [
  "direction",
  "wrap",
  "justify",
  "align",
  "alignSelf",
  "gap",
  "grow",
  "shrink",
  "padding",
  "margin",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "aspect",
  "overflow",
  "fit",
  "position",
  "left",
  "top",
  "right",
  "bottom"
] as const;

// The slots of a kept record. A scalar takes one slot; a length two: its kind, then its number.
const FLEX_DIRECTION = 0;
const FLEX_WRAP = 1;
const JUSTIFY = 2;
const ALIGN_ITEMS = 3;
const ALIGN_SELF = 4;
const GROW = 5;
const SHRINK = 6;
const ASPECT = 7;
const OVERFLOW = 8;
const POSITION_TYPE = 9;
const GAP = 10;
/** The first padding length; the edges follow in the order top, right, bottom, left. */
const PADDING = 12;
/** The first margin length, in the same edge order. */
const MARGIN = 20;
const WIDTH = 28;
const HEIGHT = 30;
const MIN_WIDTH = 32;
const MIN_HEIGHT = 34;
const MAX_WIDTH = 36;
const MAX_HEIGHT = 38;
const LEFT = 40;
const TOP = 42;
const RIGHT = 44;
const BOTTOM = 46;
/** Slots of a kept record. */
const SLOTS = 48;

/**
 * The kind of a length a number writes, and of an unset length (its number `NaN`). It is 0, so a
 * new record holds it in every kind slot: the gap, the edges and the positions only ever take it.
 */
const POINT = 0;
/** The kind of a length a percent string writes. */
const PERCENT = 1;
/** The kind of a length `"auto"` writes; its number is `NaN`. */
const AUTO = 2;
/** The kind a staged extent takes when the style writes nothing for it. Never kept. */
const SKIP = -1;

/**
 * Tells whether two resolved styles would give the same rect.
 *
 * @param first - The style of the last reconcile.
 * @param second - The style of this one.
 * @returns True when a field that reaches Yoga changed.
 */
export function layoutChanged(first: ResolvedStyle, second: ResolvedStyle): boolean {
  for (const field of LAYOUT_FIELDS) {
    const before = first[field as keyof ResolvedStyle];
    const after = second[field as keyof ResolvedStyle];

    if (before === after) continue;
    if (JSON.stringify(before ?? 0) !== JSON.stringify(after ?? 0)) return true;
  }

  return false;
}

/**
 * Reads what a node Yoga just made holds into a kept record: the enums and the flex factors through
 * their getters, once. A length is not read: its getter answers a `Value` object, so it starts
 * as Yoga's unset one, a point of `NaN`. The aspect ratio starts as one no style writes, so the
 * first write of every node calls `setAspectRatio`: the `isDirty()` of a node that never had
 * it called allocates 64 B a call (measured, `anchor.perf.ts`; a ratio of `NaN` does not cure it).
 *
 * @param yoga - The loaded Yoga module.
 * @returns The record of a fresh node.
 */
function readFresh(yoga: Yoga): KeptStyle {
  const node = yoga.Node.create();
  const fresh = new Float64Array(SLOTS);

  fresh[FLEX_DIRECTION] = node.getFlexDirection();
  fresh[FLEX_WRAP] = node.getFlexWrap();
  fresh[JUSTIFY] = node.getJustifyContent();
  fresh[ALIGN_ITEMS] = node.getAlignItems();
  fresh[ALIGN_SELF] = node.getAlignSelf();
  fresh[GROW] = node.getFlexGrow();
  fresh[SHRINK] = node.getFlexShrink();
  fresh[OVERFLOW] = node.getOverflow();
  fresh[POSITION_TYPE] = node.getPositionType();
  node.free();

  for (let slot = GAP + 1; slot < SLOTS; slot += 2) fresh[slot] = Number.NaN;
  fresh[ASPECT] = Number.NEGATIVE_INFINITY;

  return fresh;
}

/**
 * Builds the tables a style write reads for one loaded Yoga module: the enum of every word a style
 * names, what a fresh node holds, read once from a node made for it, and the record a write stages
 * its numbers in.
 *
 * @param yoga - The loaded Yoga module.
 * @returns The tables.
 */
export function styleTablesOf(yoga: Yoga): StyleTables {
  return {
    yoga,
    justify: {
      start: yoga.JUSTIFY_FLEX_START,
      center: yoga.JUSTIFY_CENTER,
      end: yoga.JUSTIFY_FLEX_END,
      between: yoga.JUSTIFY_SPACE_BETWEEN,
      around: yoga.JUSTIFY_SPACE_AROUND,
      evenly: yoga.JUSTIFY_SPACE_EVENLY
    },
    align: {
      start: yoga.ALIGN_FLEX_START,
      center: yoga.ALIGN_CENTER,
      end: yoga.ALIGN_FLEX_END,
      stretch: yoga.ALIGN_STRETCH
    },
    alignSelf: {
      auto: yoga.ALIGN_AUTO,
      start: yoga.ALIGN_FLEX_START,
      center: yoga.ALIGN_CENTER,
      end: yoga.ALIGN_FLEX_END,
      stretch: yoga.ALIGN_STRETCH
    },
    overflow: {
      visible: yoga.OVERFLOW_VISIBLE,
      hidden: yoga.OVERFLOW_HIDDEN,
      scroll: yoga.OVERFLOW_SCROLL
    },
    fresh: readFresh(yoga),
    staged: new Float64Array(SLOTS)
  };
}

/**
 * The kept record of a node Yoga just made: a copy of what the tables read off a fresh node.
 *
 * @param tables - The tables of the loaded Yoga module.
 * @returns A record of its own.
 */
export function freshKept(tables: StyleTables): KeptStyle {
  return new Float64Array(tables.fresh);
}

/**
 * Notes a width and a height written onto a node outside a style write, as the anchor pass sizes
 * the tree of an anchor, so a later style write that sets them back is not skipped.
 *
 * @param kept - The node's kept record; none for a node `ui` did not make.
 * @param size - The width and the height written, in points. Read here, not handed over as two
 *   numbers: a fractional number passed to a call V8 does not inline is boxed.
 * @param size.w - The width.
 * @param size.h - The height.
 */
export function keepSize(kept: KeptStyle | undefined, size: { w: number; h: number }): void {
  if (kept === undefined) return;

  kept[WIDTH] = POINT;
  kept[WIDTH + 1] = size.w;
  kept[HEIGHT] = POINT;
  kept[HEIGHT + 1] = size.h;
}

// A number a style carries is staged into `tables.staged` by the function that reads its field,
// and compared slot by slot from there: a fractional field handed to a call V8 does not inline is
// boxed, 16 B each. An enum is a small integer, which never boxes, and is passed as it is.

/**
 * Whether an enum must be written, and keeps it when it must. With no record every value is
 * written, as before the records.
 *
 * @param kept - The node's kept record.
 * @param slot - The enum's slot.
 * @param value - The enum of this write.
 * @returns True when the setter must be called.
 */
function enumMoved(kept: KeptStyle | undefined, slot: number, value: number): boolean {
  if (kept === undefined) return true;
  if (kept[slot] === value) return false;

  kept[slot] = value;

  return true;
}

/**
 * Whether a staged number must be written, and keeps it when it must: it differs from the kept
 * one unless both are equal or both unset (`NaN`).
 *
 * @param kept - The node's kept record.
 * @param staged - The staged values of this write.
 * @param slot - The number's slot.
 * @returns True when the setter must be called.
 */
function numberMoved(kept: KeptStyle | undefined, staged: KeptStyle, slot: number): boolean {
  if (kept === undefined) return true;

  const before = kept[slot];
  const after = staged[slot];

  if (before === after || (Number.isNaN(before) && Number.isNaN(after))) return false;

  kept[slot] = after ?? Number.NaN;

  return true;
}

/**
 * Whether a staged length must be written, and keeps it when it must: its kind and its number
 * both stand, or it is staged as nothing to write.
 *
 * @param kept - The node's kept record.
 * @param staged - The staged values of this write.
 * @param slot - The length's first slot.
 * @returns True when the setter must be called.
 */
function lengthMoved(kept: KeptStyle | undefined, staged: KeptStyle, slot: number): boolean {
  const kind = staged[slot];

  if (kind === SKIP) return false;
  if (kept === undefined) return true;
  if (kept[slot] === kind && !numberMoved(kept, staged, slot + 1)) return false;

  kept[slot] = kind ?? POINT;
  kept[slot + 1] = staged[slot + 1] ?? Number.NaN;

  return true;
}

/** Where each edge's number sits from the first slot of a padding or margin (a kind comes first). */
const EDGE_TOP_AT = 1;
const EDGE_RIGHT_AT = 3;
const EDGE_BOTTOM_AT = 5;
const EDGE_LEFT_AT = 7;

/**
 * Stages the four edges of a padding or margin given per edge; an edge it leaves out is unset.
 *
 * @param staged - The staged values of this write.
 * @param slot - The first slot of the four lengths.
 * @param edges - The edges.
 * @param edges.top - The top edge.
 * @param edges.right - The right edge.
 * @param edges.bottom - The bottom edge.
 * @param edges.left - The left edge.
 */
function stageSides(
  staged: KeptStyle,
  slot: number,
  edges: { top?: number; right?: number; bottom?: number; left?: number }
): void {
  staged[slot + EDGE_TOP_AT] = edges.top ?? Number.NaN;
  staged[slot + EDGE_RIGHT_AT] = edges.right ?? Number.NaN;
  staged[slot + EDGE_BOTTOM_AT] = edges.bottom ?? Number.NaN;
  staged[slot + EDGE_LEFT_AT] = edges.left ?? Number.NaN;
}

/**
 * Stages an extent that is not a number: a percent string, `"auto"`, or nothing. `undefined`
 * writes nothing, and so does `"auto"` on a min or max extent.
 *
 * @param staged - The staged values of this write.
 * @param slot - The extent's first slot.
 * @param value - What the style carries.
 * @param autoSkips - Whether `"auto"` writes nothing here.
 */
function stageWord(
  staged: KeptStyle,
  slot: number,
  value: string | undefined,
  autoSkips: boolean
): void {
  if (value === undefined || (autoSkips && value === "auto")) {
    staged[slot] = SKIP;
  } else if (value === "auto") {
    staged[slot] = AUTO;
    staged[slot + 1] = Number.NaN;
  } else {
    staged[slot] = value.endsWith("%") ? PERCENT : POINT;
    staged[slot + 1] = Number.parseFloat(value);
  }
}

/**
 * Stages the edges of the padding and the margin.
 *
 * @param staged - The staged values of this write.
 * @param style - The resolved style.
 */
function stageEdges(staged: KeptStyle, style: ResolvedStyle): void {
  const { padding, margin } = style;

  if (typeof padding === "object") stageSides(staged, PADDING, padding);
  else {
    const all = padding ?? Number.NaN;

    staged[PADDING + EDGE_TOP_AT] = all;
    staged[PADDING + EDGE_RIGHT_AT] = all;
    staged[PADDING + EDGE_BOTTOM_AT] = all;
    staged[PADDING + EDGE_LEFT_AT] = all;
  }
  if (typeof margin === "object") stageSides(staged, MARGIN, margin);
  else {
    const all = margin ?? Number.NaN;

    staged[MARGIN + EDGE_TOP_AT] = all;
    staged[MARGIN + EDGE_RIGHT_AT] = all;
    staged[MARGIN + EDGE_BOTTOM_AT] = all;
    staged[MARGIN + EDGE_LEFT_AT] = all;
  }
}

/**
 * Stages the six extents and the aspect ratio. A number is staged here, where it is read; a word by
 * `stageWord`.
 *
 * @param staged - The staged values of this write.
 * @param style - The resolved style.
 */
function stageExtents(staged: KeptStyle, style: ResolvedStyle): void {
  const { width, height, minWidth, minHeight, maxWidth, maxHeight } = style;

  // Size: a word may be "auto".
  if (typeof width === "number") {
    staged[WIDTH] = POINT;
    staged[WIDTH + 1] = width;
  } else stageWord(staged, WIDTH, width, false);
  if (typeof height === "number") {
    staged[HEIGHT] = POINT;
    staged[HEIGHT + 1] = height;
  } else stageWord(staged, HEIGHT, height, false);

  // Min: "auto" writes nothing.
  if (typeof minWidth === "number") {
    staged[MIN_WIDTH] = POINT;
    staged[MIN_WIDTH + 1] = minWidth;
  } else stageWord(staged, MIN_WIDTH, minWidth, true);
  if (typeof minHeight === "number") {
    staged[MIN_HEIGHT] = POINT;
    staged[MIN_HEIGHT + 1] = minHeight;
  } else stageWord(staged, MIN_HEIGHT, minHeight, true);

  // Max: "auto" writes nothing.
  if (typeof maxWidth === "number") {
    staged[MAX_WIDTH] = POINT;
    staged[MAX_WIDTH + 1] = maxWidth;
  } else stageWord(staged, MAX_WIDTH, maxWidth, true);
  if (typeof maxHeight === "number") {
    staged[MAX_HEIGHT] = POINT;
    staged[MAX_HEIGHT + 1] = maxHeight;
  } else stageWord(staged, MAX_HEIGHT, maxHeight, true);

  // Aspect: unset is NaN.
  staged[ASPECT] = style.aspect ?? Number.NaN;
}

/**
 * Stages the numbers of the flow and position groups: gap, grow, shrink and the four positions.
 *
 * @param staged - The staged values of this write.
 * @param style - The resolved style.
 */
function stageFlowAndPosition(staged: KeptStyle, style: ResolvedStyle): void {
  staged[GAP + 1] = style.gap ?? 0;
  staged[GROW] = style.grow ?? 0;
  staged[SHRINK] = style.shrink ?? 0;
  staged[LEFT + 1] = style.left ?? Number.NaN;
  staged[TOP + 1] = style.top ?? Number.NaN;
  staged[RIGHT + 1] = style.right ?? Number.NaN;
  staged[BOTTOM + 1] = style.bottom ?? Number.NaN;
}

/**
 * Reads one edge of a padding or margin.
 *
 * @param edges - What the resolved style carries.
 * @param edge - The edge to read.
 * @returns The number, or `undefined`.
 */
function edge(
  edges: ResolvedStyle["padding"],
  edge: "top" | "right" | "bottom" | "left"
): number | undefined {
  if (edges === undefined) return undefined;
  if (typeof edges === "number") return edges;

  return edges[edge];
}

/**
 * Writes the flow group onto a node.
 *
 * @param tables - The tables of the loaded Yoga module, its numbers staged.
 * @param node - The node of the element.
 * @param style - The resolved style.
 * @param column - Whether the tag lays its children out in a column.
 * @param kept - The node's kept record.
 */
function applyFlow(
  tables: StyleTables,
  node: YogaNode,
  style: ResolvedStyle,
  column: boolean,
  kept: KeptStyle | undefined
): void {
  const { yoga, staged } = tables;
  const row = (style.direction ?? (column ? "column" : "row")) === "row";
  const direction = row ? yoga.FLEX_DIRECTION_ROW : yoga.FLEX_DIRECTION_COLUMN;
  const wrap = style.wrap === true ? yoga.WRAP_WRAP : yoga.WRAP_NO_WRAP;
  const justify = tables.justify[style.justify ?? "start"];
  const align = tables.align[style.align ?? "stretch"];
  const alignSelf = tables.alignSelf[style.alignSelf ?? "auto"];

  if (enumMoved(kept, FLEX_DIRECTION, direction)) node.setFlexDirection(direction);
  if (enumMoved(kept, FLEX_WRAP, wrap)) node.setFlexWrap(wrap);
  if (enumMoved(kept, JUSTIFY, justify)) node.setJustifyContent(justify);
  if (enumMoved(kept, ALIGN_ITEMS, align)) node.setAlignItems(align);
  if (enumMoved(kept, ALIGN_SELF, alignSelf)) node.setAlignSelf(alignSelf);
  if (lengthMoved(kept, staged, GAP)) node.setGap(yoga.GUTTER_ALL, style.gap ?? 0);
  if (numberMoved(kept, staged, GROW)) node.setFlexGrow(style.grow ?? 0);
  if (numberMoved(kept, staged, SHRINK)) node.setFlexShrink(style.shrink ?? 0);
}

/**
 * Writes the padding and the margin of one edge.
 *
 * @param node - The node of the element.
 * @param style - The resolved style.
 * @param kept - The node's kept record.
 * @param staged - The staged values of this write.
 * @param side - The edge, by name.
 * @param index - Its place in the order top, right, bottom, left.
 * @param which - The edge, as Yoga names it.
 */
function applyEdge(
  node: YogaNode,
  style: ResolvedStyle,
  kept: KeptStyle | undefined,
  staged: KeptStyle,
  side: "top" | "right" | "bottom" | "left",
  index: number,
  which: Edge
): void {
  if (lengthMoved(kept, staged, PADDING + index * 2)) {
    node.setPadding(which, edge(style.padding, side));
  }
  if (lengthMoved(kept, staged, MARGIN + index * 2)) {
    node.setMargin(which, edge(style.margin, side));
  }
}

/**
 * Writes the six extents through the right setter: `"auto"`, a percent string and a number are
 * three different Yoga calls. An extent staged as nothing to write is left alone.
 *
 * @param node - The node of the element.
 * @param style - The resolved style.
 * @param kept - The node's kept record.
 * @param staged - The staged values of this write.
 */
function applyExtents(
  node: YogaNode,
  style: ResolvedStyle,
  kept: KeptStyle | undefined,
  staged: KeptStyle
): void {
  const { width, height, minWidth, minHeight, maxWidth, maxHeight } = style;

  if (lengthMoved(kept, staged, WIDTH)) node.setWidth(width);
  if (lengthMoved(kept, staged, HEIGHT)) node.setHeight(height);
  // A min or max extent is staged as nothing to write for `"auto"`: the checks only narrow it.
  if (minWidth !== "auto" && lengthMoved(kept, staged, MIN_WIDTH)) node.setMinWidth(minWidth);
  if (minHeight !== "auto" && lengthMoved(kept, staged, MIN_HEIGHT)) node.setMinHeight(minHeight);
  if (maxWidth !== "auto" && lengthMoved(kept, staged, MAX_WIDTH)) node.setMaxWidth(maxWidth);
  if (maxHeight !== "auto" && lengthMoved(kept, staged, MAX_HEIGHT)) node.setMaxHeight(maxHeight);
}

/**
 * Writes the box group onto a node.
 *
 * @param tables - The tables of the loaded Yoga module, its numbers staged.
 * @param node - The node of the element.
 * @param style - The resolved style.
 * @param kept - The node's kept record.
 */
function applyBox(
  tables: StyleTables,
  node: YogaNode,
  style: ResolvedStyle,
  kept: KeptStyle | undefined
): void {
  const { yoga, staged } = tables;
  const overflow = tables.overflow[style.overflow ?? "visible"];

  applyEdge(node, style, kept, staged, "top", 0, yoga.EDGE_TOP);
  applyEdge(node, style, kept, staged, "right", 1, yoga.EDGE_RIGHT);
  applyEdge(node, style, kept, staged, "bottom", 2, yoga.EDGE_BOTTOM);
  applyEdge(node, style, kept, staged, "left", 3, yoga.EDGE_LEFT);
  applyExtents(node, style, kept, staged);
  if (numberMoved(kept, staged, ASPECT)) node.setAspectRatio(style.aspect);
  if (enumMoved(kept, OVERFLOW, overflow)) node.setOverflow(overflow);
}

/**
 * Writes the position group onto a node. A child of a `stack` is absolute unless it says
 * otherwise, which is what makes a stack a stack. A fitted element is absolute too: it keeps its
 * own size and never stretches its parent, and the solve centres it in the parent's content box.
 *
 * @param tables - The tables of the loaded Yoga module, its numbers staged.
 * @param node - The node of the element.
 * @param style - The resolved style.
 * @param stacked - Whether the parent tag is a `stack`.
 * @param kept - The node's kept record.
 */
function applyPosition(
  tables: StyleTables,
  node: YogaNode,
  style: ResolvedStyle,
  stacked: boolean,
  kept: KeptStyle | undefined
): void {
  const { yoga, staged } = tables;
  const absolute =
    style.position === "absolute" ||
    style.fit === "contain" ||
    (stacked && style.position === undefined);
  const type = absolute ? yoga.POSITION_TYPE_ABSOLUTE : yoga.POSITION_TYPE_RELATIVE;

  if (enumMoved(kept, POSITION_TYPE, type)) node.setPositionType(type);
  if (lengthMoved(kept, staged, LEFT)) node.setPosition(yoga.EDGE_LEFT, style.left);
  if (lengthMoved(kept, staged, TOP)) node.setPosition(yoga.EDGE_TOP, style.top);
  if (lengthMoved(kept, staged, RIGHT)) node.setPosition(yoga.EDGE_RIGHT, style.right);
  if (lengthMoved(kept, staged, BOTTOM)) node.setPosition(yoga.EDGE_BOTTOM, style.bottom);
}

/**
 * Writes one resolved style onto one Yoga node. With the node's kept record, a setter is called
 * only for a value that differs from the one the record keeps, and the record takes what was
 * written; without one, every setter is called. The order of the calls is the order of the groups:
 * flow, box (each edge's padding then margin, the extents, the ratio, the overflow), position.
 *
 * @param yoga - The loaded Yoga module.
 * @param node - The node of the element.
 * @param style - The resolved style.
 * @param tag - The intrinsic tag, which decides the default direction.
 * @param parentTag - The tag of the parent, which decides whether children stack.
 * @param kept - The node's kept record, made with the node; none writes every value.
 * @param tables - The tables of the loaded module; built for this call when none is given.
 */
export function applyStyleToNode(
  yoga: Yoga,
  node: YogaNode,
  style: ResolvedStyle,
  tag: string,
  parentTag: string | undefined,
  kept?: KeptStyle,
  tables: StyleTables = styleTablesOf(yoga)
): void {
  stageEdges(tables.staged, style);
  stageExtents(tables.staged, style);
  stageFlowAndPosition(tables.staged, style);
  applyFlow(tables, node, style, tag !== "row", kept);
  applyBox(tables, node, style, kept);
  applyPosition(tables, node, style, parentTag === "stack", kept);
}
