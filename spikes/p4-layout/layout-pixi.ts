// Spike P4. Adapter B: @pixi/layout in manual mode behind the Layout interface. One hidden Container
// per entity. The LayoutSystem is instantiated directly, so it runs without a renderer.

import "@pixi/layout";
import { LayoutSystem, type LayoutStyles } from "@pixi/layout";
import { Container } from "pixi.js";
import type { Node } from "yoga-layout/load";
import { MeasureMode } from "yoga-layout/load";
import type { Entity, Layout, Rect, Size } from "./core";
import type { FlatStyle, Viewport } from "./styles";

const JUSTIFY: Record<NonNullable<FlatStyle["justify"]>, NonNullable<LayoutStyles["justifyContent"]>> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly"
};
const ALIGN: Record<NonNullable<FlatStyle["align"]>, NonNullable<LayoutStyles["alignItems"]>> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch"
};

/** The @pixi/layout style for one flat style. Undefined keys are left out. */
export function toLayoutStyles(flat: FlatStyle): LayoutStyles {
  const style: LayoutStyles = {
    flexDirection: flat.direction === "row" ? "row" : "column",
    flexWrap: flat.wrap ? "wrap" : "nowrap",
    justifyContent: flat.justify ? JUSTIFY[flat.justify] : "flex-start",
    alignItems: flat.align ? ALIGN[flat.align] : "stretch",
    position: flat.position === "absolute" ? "absolute" : "relative",
    overflow: flat.overflow === "hidden" ? "hidden" : "visible"
  };
  if (flat.gap !== undefined) style.gap = flat.gap;
  if (typeof flat.padding === "number") style.padding = flat.padding;
  else if (flat.padding?.length === 2) {
    style.paddingTop = flat.padding[0];
    style.paddingBottom = flat.padding[0];
    style.paddingLeft = flat.padding[1];
    style.paddingRight = flat.padding[1];
  } else if (flat.padding?.length === 4) {
    style.paddingTop = flat.padding[0];
    style.paddingRight = flat.padding[1];
    style.paddingBottom = flat.padding[2];
    style.paddingLeft = flat.padding[3];
  }
  if (flat.margin !== undefined) style.margin = flat.margin;
  if (flat.width !== undefined) style.width = flat.width;
  if (flat.height !== undefined) style.height = flat.height;
  if (flat.minWidth !== undefined) style.minWidth = flat.minWidth;
  if (flat.minHeight !== undefined) style.minHeight = flat.minHeight;
  if (flat.maxWidth !== undefined) style.maxWidth = flat.maxWidth;
  if (flat.maxHeight !== undefined) style.maxHeight = flat.maxHeight;
  if (flat.grow !== undefined) style.flexGrow = flat.grow;
  if (flat.shrink !== undefined) style.flexShrink = flat.shrink;
  if (flat.left !== undefined) style.left = flat.left;
  if (flat.top !== undefined) style.top = flat.top;
  if (flat.right !== undefined) style.right = flat.right;
  if (flat.bottom !== undefined) style.bottom = flat.bottom;
  if (flat.aspect !== undefined) style.aspectRatio = flat.aspect;
  return style;
}

export async function createPixiLayout(): Promise<Layout> {
  const t0 = performance.now();
  const system = new LayoutSystem();
  await system.init({ layout: { autoUpdate: false, enableDebug: false, throttle: 0, debugModificationCount: 50 } });
  const initMs = performance.now() - t0;

  const containers = new Map<number, Container>();
  let count = 0;
  const state = { measureCalls: 0 };

  const containerOf = (entity: Entity): Container => {
    const container = containers.get(entity.id);
    if (!container) throw new Error(`no container for entity ${entity.id} (${entity.key})`);
    return container;
  };
  const yogaOf = (container: Container): Node => {
    const layout = container.layout;
    if (!layout) throw new Error("container has no layout");
    return layout.yoga as Node;
  };

  return {
    name: "B",
    initMs,
    get measureCalls() {
      return state.measureCalls;
    },
    attach(entity) {
      const container = new Container({ label: entity.key });
      container.layout = {};
      containers.set(entity.id, container);
      count++;
    },
    detach(entity) {
      const container = containers.get(entity.id);
      if (!container) return;
      container.parent?.removeChild(container);
      // `layout = null` destroys the Layout object, which frees the Yoga node (Layout.destroy).
      container.layout = null;
      container.destroy({ children: false });
      containers.delete(entity.id);
      count--;
    },
    place(parent, children) {
      const parentContainer = containerOf(parent);
      parentContainer.removeChildren();
      for (const child of children) parentContainer.addChild(containerOf(child));
    },
    style(entity, flat) {
      containerOf(entity).layout = toLayoutStyles(flat);
    },
    measure(entity, fn) {
      // @pixi/layout has no measure-function API: intrinsic size comes from Pixi bounds (`width: "intrinsic"`,
      // read by getPixiSize and throttled). The spike reaches the Yoga node the Layout owns, which is typed
      // Readonly<Node>; this is an escape hatch and RESULT says so.
      const node = yogaOf(containerOf(entity));
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
      const container = containerOf(entity);
      yogaOf(container).markDirty();
      container.layout?.invalidateRoot();
    },
    solve(root, viewport: Viewport) {
      const rootContainer = containerOf(root);
      rootContainer.layout = { width: viewport.width, height: viewport.height, flexDirection: "column" };
      system.update(rootContainer);
      const rects = new Map<number, Rect>();
      for (const [id, container] of containers) {
        if (id !== root.id && !container.parent) continue;
        const computed = container.layout?.computedLayout;
        if (!computed) continue;
        rects.set(id, { x: computed.left, y: computed.top, w: computed.width, h: computed.height });
      }
      return rects;
    },
    nodeCount() {
      return count;
    }
  };
}

/**
 * The offset fact of RESULT point 3 for adapter B: with a layout attached, `container.x` is an offset
 * from the laid-out position (ContainerMixin: `position._x + x`). Returns the laid-out x, the
 * `realX` the package reports after `x = 40`, and the local transform's tx.
 */
export async function offsetProbe(): Promise<{ left: number; realX: number; tx: number }> {
  const system = new LayoutSystem();
  await system.init({ layout: { autoUpdate: false, enableDebug: false, throttle: 0, debugModificationCount: 50 } });
  const root = new Container();
  root.layout = { width: 400, height: 200, flexDirection: "row", justifyContent: "center", alignItems: "center" };
  const child = new Container();
  child.layout = { width: 100, height: 100 };
  root.addChild(child);
  system.update(root);
  child.x = 40;
  child.updateLocalTransform();
  const layout = child.layout;
  const result = { left: layout?.computedLayout.left ?? Number.NaN, realX: layout?.realX ?? Number.NaN, tx: child.localTransform.tx };
  root.layout = null;
  child.layout = null;
  root.destroy({ children: true });
  return result;
}
