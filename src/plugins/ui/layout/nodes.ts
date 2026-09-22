/**
 * @file ui/layout — the lifetime of a Yoga node: one per ui entity, inserted into its parent
 * when the element enters, removed before it is freed. `nodes` is attach minus detach.
 */
import type { Node as YogaNode } from "yoga-layout/load";
import type { Element } from "../jsx/types";
import type { LayoutState } from "./types";

/**
 * Creates the node of an element and counts it.
 *
 * @param state - The layout state.
 * @param element - The element that entered.
 * @returns The node, or `undefined` while Yoga is still loading.
 */
export function createNode(state: LayoutState, element: Element): YogaNode | undefined {
  if (state.yoga === undefined) return undefined;

  const existing = state.byEntity.get(element.entity);

  if (existing !== undefined) return existing;

  const node = state.yoga.Node.create();

  state.byEntity.set(element.entity, node);
  state.nodes += 1;

  return node;
}

/**
 * Takes an element out of its parent's node, which is what makes it leave the flow at once.
 *
 * @param state - The layout state.
 * @param element - The element that exits.
 */
export function detachNode(state: LayoutState, element: Element): void {
  const node = state.byEntity.get(element.entity);
  const parent = node?.getParent() ?? undefined;

  if (node === undefined || parent === undefined) return;

  // eslint-disable-next-line unicorn/prefer-dom-node-remove -- a Yoga node is not a DOM node.
  parent.removeChild(node);
}

/**
 * Frees the node of an element, after it left its parent: `free()` on an attached node throws.
 *
 * @param state - The layout state.
 * @param element - The element that despawns.
 */
export function freeNode(state: LayoutState, element: Element): void {
  const node = state.byEntity.get(element.entity);

  if (node === undefined) return;

  detachNode(state, element);
  // eslint-disable-next-line unicorn/no-null -- Yoga clears a measure function with null.
  node.setMeasureFunc(null);
  node.free();
  state.byEntity.delete(element.entity);
  state.nodes -= 1;
}

/**
 * Re-places the children of one parent: remove all, insert in order. Once per parent per
 * reconcile — per exiting child it made a thousand-row churn quadratic (spike P4, point 4).
 *
 * @param state - The layout state.
 * @param parent - The element whose child list changed.
 * @param children - Its children, in child order.
 */
export function placeChildren(
  state: LayoutState,
  parent: Element,
  children: readonly Element[]
): void {
  const node = state.byEntity.get(parent.entity);

  if (node === undefined) return;

  for (let index = node.getChildCount() - 1; index >= 0; index -= 1) {
    // eslint-disable-next-line unicorn/prefer-dom-node-remove -- a Yoga node is not a DOM node.
    node.removeChild(node.getChild(index));
  }

  let index = 0;

  for (const child of children) {
    const childNode = state.byEntity.get(child.entity);

    if (childNode === undefined) continue;

    node.insertChild(childNode, index);
    index += 1;
  }
}
