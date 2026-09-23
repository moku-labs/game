/**
 * @file ui/layout — the style vocabulary written onto a Yoga node, and the test that tells a
 * layout change from a visual one. Pure over the module Yoga hands out.
 */
import type { Yoga, Node as YogaNode } from "yoga-layout/load";
import type { Extent, ResolvedStyle } from "../styles/types";

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
 * @param yoga - The loaded Yoga module, which carries the enums.
 * @param node - The node of the element.
 * @param style - The resolved style.
 * @param column - Whether the tag lays its children out in a column.
 */
function applyFlow(yoga: Yoga, node: YogaNode, style: ResolvedStyle, column: boolean): void {
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
 * Writes one extent through the right setter: `"auto"`, a percent string and a number are three
 * different Yoga calls.
 *
 * @param node - The node of the element.
 * @param field - Which extent is written.
 * @param value - What the style carries.
 */
function applyExtent(
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
 * Writes the box group onto a node.
 *
 * @param yoga - The loaded Yoga module.
 * @param node - The node of the element.
 * @param style - The resolved style.
 */
function applyBox(yoga: Yoga, node: YogaNode, style: ResolvedStyle): void {
  const edges = [
    ["top", yoga.EDGE_TOP],
    ["right", yoga.EDGE_RIGHT],
    ["bottom", yoga.EDGE_BOTTOM],
    ["left", yoga.EDGE_LEFT]
  ] as const;

  for (const [name, which] of edges) {
    node.setPadding(which, edge(style.padding, name));
    node.setMargin(which, edge(style.margin, name));
  }

  applyExtent(node, "width", style.width);
  applyExtent(node, "height", style.height);
  applyExtent(node, "minWidth", style.minWidth);
  applyExtent(node, "minHeight", style.minHeight);
  applyExtent(node, "maxWidth", style.maxWidth);
  applyExtent(node, "maxHeight", style.maxHeight);
  node.setAspectRatio(style.aspect);
  node.setOverflow(
    { visible: yoga.OVERFLOW_VISIBLE, hidden: yoga.OVERFLOW_HIDDEN, scroll: yoga.OVERFLOW_SCROLL }[
      style.overflow ?? "visible"
    ]
  );
}

/**
 * Writes the position group onto a node. A child of a `stack` is absolute unless it says
 * otherwise, which is what makes a stack a stack. A fitted element is absolute too: it keeps its
 * own size and never stretches its parent, and the solve centres it in the parent's content box.
 *
 * @param yoga - The loaded Yoga module.
 * @param node - The node of the element.
 * @param style - The resolved style.
 * @param stacked - Whether the parent tag is a `stack`.
 */
function applyPosition(yoga: Yoga, node: YogaNode, style: ResolvedStyle, stacked: boolean): void {
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
 * Writes one resolved style onto one Yoga node.
 *
 * @param yoga - The loaded Yoga module.
 * @param node - The node of the element.
 * @param style - The resolved style.
 * @param tag - The intrinsic tag, which decides the default direction.
 * @param parentTag - The tag of the parent, which decides whether children stack.
 */
export function applyStyleToNode(
  yoga: Yoga,
  node: YogaNode,
  style: ResolvedStyle,
  tag: string,
  parentTag: string | undefined
): void {
  applyFlow(yoga, node, style, tag !== "row");
  applyBox(yoga, node, style);
  applyPosition(yoga, node, style, parentTag === "stack");
}
