// Spike P4. Adapter A: raw yoga-layout behind the Layout interface. One Yoga node per entity.

import { Align, Direction, Edge, FlexDirection, Gutter, Justify, MeasureMode, Overflow, PositionType, Wrap, loadYoga, type Node } from "yoga-layout/load";
import type { Entity, Layout, Rect, Size } from "./core";
import type { FlatStyle, Length } from "./styles";
import type { Viewport } from "./styles";

const JUSTIFY: Record<NonNullable<FlatStyle["justify"]>, Justify> = {
  start: Justify.FlexStart,
  center: Justify.Center,
  end: Justify.FlexEnd,
  between: Justify.SpaceBetween,
  around: Justify.SpaceAround,
  evenly: Justify.SpaceEvenly
};
const ALIGN: Record<NonNullable<FlatStyle["align"]>, Align> = {
  start: Align.FlexStart,
  center: Align.Center,
  end: Align.FlexEnd,
  stretch: Align.Stretch
};

const setLength = (set: (value: number | `${number}%` | undefined) => void, setAuto: () => void, value: Length | undefined): void => {
  if (value === "auto") setAuto();
  else set(value);
};

export async function createYogaLayout(): Promise<Layout> {
  const t0 = performance.now();
  const yoga = await loadYoga();
  const initMs = performance.now() - t0;

  const nodes = new Map<number, Node>();
  let count = 0;
  const state = { measureCalls: 0 };
  const hasInstanceCount = typeof (yoga.Node as unknown as { getInstanceCount?: unknown }).getInstanceCount === "function";

  const nodeOf = (entity: Entity): Node => {
    const node = nodes.get(entity.id);
    if (!node) throw new Error(`no yoga node for entity ${entity.id} (${entity.key})`);
    return node;
  };

  const detachFromParent = (node: Node): void => {
    const parent = node.getParent();
    if (parent) parent.removeChild(node);
  };

  const applyPadding = (node: Node, padding: FlatStyle["padding"]): void => {
    if (padding === undefined) {
      node.setPadding(Edge.All, undefined);
      return;
    }
    if (typeof padding === "number") {
      node.setPadding(Edge.All, padding);
      return;
    }
    if (padding.length === 2) {
      node.setPadding(Edge.Vertical, padding[0]);
      node.setPadding(Edge.Horizontal, padding[1]);
      return;
    }
    node.setPadding(Edge.Top, padding[0]);
    node.setPadding(Edge.Right, padding[1]);
    node.setPadding(Edge.Bottom, padding[2]);
    node.setPadding(Edge.Left, padding[3]);
  };

  return {
    name: "A",
    initMs,
    get measureCalls() {
      return state.measureCalls;
    },
    attach(entity) {
      nodes.set(entity.id, yoga.Node.create());
      count++;
    },
    detach(entity) {
      const node = nodes.get(entity.id);
      if (!node) return;
      detachFromParent(node);
      // Children are detached by their own `detach` calls; free this node alone.
      node.free();
      nodes.delete(entity.id);
      count--;
    },
    place(parent, children) {
      const parentNode = nodeOf(parent);
      while (parentNode.getChildCount() > 0) parentNode.removeChild(parentNode.getChild(0));
      children.forEach((child, index) => {
        const node = nodeOf(child);
        detachFromParent(node);
        parentNode.insertChild(node, index);
      });
    },
    style(entity, flat) {
      const node = nodeOf(entity);
      node.setFlexDirection(flat.direction === "row" ? FlexDirection.Row : FlexDirection.Column);
      node.setFlexWrap(flat.wrap ? Wrap.Wrap : Wrap.NoWrap);
      node.setJustifyContent(flat.justify ? JUSTIFY[flat.justify] : Justify.FlexStart);
      node.setAlignItems(flat.align ? ALIGN[flat.align] : Align.Stretch);
      node.setGap(Gutter.All, flat.gap);
      applyPadding(node, flat.padding);
      node.setMargin(Edge.All, flat.margin);
      setLength(v => node.setWidth(v), () => node.setWidthAuto(), flat.width);
      setLength(v => node.setHeight(v), () => node.setHeightAuto(), flat.height);
      node.setMinWidth(flat.minWidth);
      node.setMinHeight(flat.minHeight);
      node.setMaxWidth(flat.maxWidth);
      node.setMaxHeight(flat.maxHeight);
      node.setFlexGrow(flat.grow);
      node.setFlexShrink(flat.shrink);
      node.setPositionType(flat.position === "absolute" ? PositionType.Absolute : PositionType.Relative);
      node.setPosition(Edge.Left, flat.left);
      node.setPosition(Edge.Top, flat.top);
      node.setPosition(Edge.Right, flat.right);
      node.setPosition(Edge.Bottom, flat.bottom);
      node.setAspectRatio(flat.aspect);
      node.setOverflow(flat.overflow === "hidden" ? Overflow.Hidden : Overflow.Visible);
    },
    measure(entity, fn) {
      const node = nodeOf(entity);
      if (!fn) {
        node.unsetMeasureFunc();
        return;
      }
      node.setMeasureFunc((width, widthMode, height, heightMode) => {
        state.measureCalls++;
        const size: Size = fn();
        const w = widthMode === MeasureMode.Exactly ? width : widthMode === MeasureMode.AtMost ? Math.min(width, size.width) : size.width;
        const h = heightMode === MeasureMode.Exactly ? height : heightMode === MeasureMode.AtMost ? Math.min(height, size.height) : size.height;
        return { width: w, height: h };
      });
    },
    invalidate(entity) {
      nodeOf(entity).markDirty();
    },
    solve(root, viewport: Viewport) {
      const rootNode = nodeOf(root);
      rootNode.calculateLayout(viewport.width, viewport.height, Direction.LTR);
      const rects = new Map<number, Rect>();
      for (const [id, node] of nodes) {
        if (id !== root.id && !node.getParent()) continue;
        rects.set(id, { x: node.getComputedLeft(), y: node.getComputedTop(), w: node.getComputedWidth(), h: node.getComputedHeight() });
      }
      return rects;
    },
    nodeCount() {
      return hasInstanceCount ? (yoga.Node as unknown as { getInstanceCount(): number }).getInstanceCount() : count;
    }
  };
}

/** Whether the installed Yoga exposes a direct instance count. Read by measure.ts for the `indirect` mark. */
export async function yogaHasInstanceCount(): Promise<boolean> {
  const yoga = await loadYoga();
  return typeof (yoga.Node as unknown as { getInstanceCount?: unknown }).getInstanceCount === "function";
}
