/**
 * @file ui/layout — one `calculateLayout` per marked root, then the walk that turns the computed
 * offsets into rects in root coordinates. Never per frame, never on scroll.
 */
import type { Element } from "../jsx/types";
import type { ElementLookup, LayoutState, Rect } from "./types";

/**
 * Walks the element tree and writes the rect of every element in root coordinates.
 *
 * @param state - The layout state, for the node of each element.
 * @param element - The element to place.
 * @param origin - Where its parent sits, in root coordinates.
 * @param origin.x - The left of the parent.
 * @param origin.y - The top of the parent.
 * @param lookup - How a child entity becomes its element.
 * @returns True when at least one rect changed.
 */
function place(
  state: LayoutState,
  element: Element,
  origin: { x: number; y: number },
  lookup: ElementLookup
): boolean {
  const node = state.byEntity.get(element.entity);

  if (node === undefined) return false;

  const rect: Rect = {
    x: origin.x + node.getComputedLeft(),
    y: origin.y + node.getComputedTop(),
    w: node.getComputedWidth(),
    h: node.getComputedHeight()
  };
  const before = element.rect;
  const moved =
    before.x !== rect.x || before.y !== rect.y || before.w !== rect.w || before.h !== rect.h;
  let changed = moved;

  element.previous = before;
  element.moved = moved;
  element.rect = rect;

  for (const child of element.children) {
    const childElement = lookup(child);

    if (childElement === undefined) continue;
    if (place(state, childElement, rect, lookup)) changed = true;
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

  return place(state, rootElement, { x: size.x, y: size.y }, lookup);
}
