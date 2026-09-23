/**
 * @file ui/layout — one `calculateLayout` per marked root, then the walk that turns the computed
 * offsets into rects in root coordinates. Never per frame, never on scroll. An element with
 * `fit: "contain"` is laid out at its own size, out of the flow, then centred in the content box
 * of its parent with the scale that fits it; its children keep their natural rects.
 */
import type { Node as YogaNode } from "yoga-layout/load";
import type { Element } from "../jsx/types";
import type { ElementLookup, LayoutState, Rect } from "./types";

/**
 * Where the children of a parent are placed: its own rect, and the part of it inside its padding.
 */
type Frame = { origin: { x: number; y: number }; content: Rect };

/**
 * Centres a box of a natural size in a content box and finds the scale that fits it there.
 *
 * @param content - The content box of the parent, in root coordinates.
 * @param width - The natural width of the fitted element.
 * @param height - The natural height of the fitted element.
 * @returns The natural rect, centred, and the fit scale: never above 1, 0 when there is no room.
 * @example
 * ```ts
 * fitInto({ x: 20, y: 320, w: 1040, h: 776 }, 970, 970);
 * // { rect: { x: 55, y: 223, w: 970, h: 970 }, fit: 0.8 }
 * ```
 */
export function fitInto(content: Rect, width: number, height: number): { rect: Rect; fit: number } {
  const fit = width > 0 && height > 0 ? Math.min(1, content.w / width, content.h / height) : 1;

  return {
    rect: {
      x: content.x + (content.w - width) / 2,
      y: content.y + (content.h - height) / 2,
      w: width,
      h: height
    },
    fit: Math.max(0, fit)
  };
}

/**
 * The frame the children of an element are placed in: its rect, less its computed padding.
 *
 * @param state - The layout state, for the edge enums of Yoga.
 * @param rect - The rect of the element.
 * @param node - Its Yoga node.
 * @returns The frame.
 */
function frameOf(state: LayoutState, rect: Rect, node: YogaNode): Frame {
  const yoga = state.yoga;

  if (yoga === undefined) return { origin: { x: rect.x, y: rect.y }, content: rect };

  const left = node.getComputedPadding(yoga.EDGE_LEFT);
  const top = node.getComputedPadding(yoga.EDGE_TOP);
  const right = node.getComputedPadding(yoga.EDGE_RIGHT);
  const bottom = node.getComputedPadding(yoga.EDGE_BOTTOM);

  return {
    origin: { x: rect.x, y: rect.y },
    content: {
      x: rect.x + left,
      y: rect.y + top,
      w: rect.w - left - right,
      h: rect.h - top - bottom
    }
  };
}

/**
 * Walks the element tree and writes the rect of every element in root coordinates.
 *
 * @param state - The layout state, for the node of each element.
 * @param element - The element to place.
 * @param frame - Where its parent sits and its parent's content box, in root coordinates.
 * @param lookup - How a child entity becomes its element.
 * @returns True when at least one rect or fit scale changed.
 */
function place(state: LayoutState, element: Element, frame: Frame, lookup: ElementLookup): boolean {
  const node = state.byEntity.get(element.entity);

  if (node === undefined) return false;

  const width = node.getComputedWidth();
  const height = node.getComputedHeight();
  const fitted =
    element.style.fit === "contain" ? fitInto(frame.content, width, height) : undefined;
  const rect: Rect = fitted?.rect ?? {
    x: frame.origin.x + node.getComputedLeft(),
    y: frame.origin.y + node.getComputedTop(),
    w: width,
    h: height
  };
  const fit = fitted?.fit ?? 1;
  const before = element.rect;
  const moved =
    before.x !== rect.x || before.y !== rect.y || before.w !== rect.w || before.h !== rect.h;
  let changed = moved || fit !== element.fit;

  element.previous = before;
  element.moved = moved;
  element.rect = rect;
  element.fit = fit;

  const inner = frameOf(state, rect, node);

  for (const child of element.children) {
    const childElement = lookup(child);

    if (childElement === undefined) continue;
    if (place(state, childElement, inner, lookup)) changed = true;
  }

  return changed;
}

/**
 * Solves one root and writes every rect under it.
 *
 * @param state - The layout state.
 * @param rootElement - The element that carries the tree.
 * @param size - The rect the root is solved in: the viewport, for a screen and for a popup.
 * @param lookup - How a child entity becomes its element.
 * @returns True when at least one rect changed.
 */
export function solveRoot(
  state: LayoutState,
  rootElement: Element,
  size: Rect,
  lookup: ElementLookup
): boolean {
  const node = state.byEntity.get(rootElement.entity);

  if (state.yoga === undefined || node === undefined) return false;

  node.calculateLayout(size.w, size.h, state.yoga.DIRECTION_LTR);
  state.solves += 1;

  return place(state, rootElement, { origin: { x: size.x, y: size.y }, content: size }, lookup);
}
