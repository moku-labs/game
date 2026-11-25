/**
 * @file ui/layout — the lifetime of a Yoga node: one per ui entity, inserted into its parent
 * when the element enters, removed before it is freed. `nodes` is attach minus detach.
 */
import type { Yoga, Node as YogaNode } from "yoga-layout/load";
import type { Element } from "../jsx/types";
import { ANCHOR } from "../visual";
import { freshKept, styleTablesOf } from "./apply";
import type { LayoutState, StyleTables } from "./types";

/**
 * The style tables of the loaded module, built the first time a node of it is made.
 *
 * @param state - The layout state.
 * @param yoga - The loaded Yoga module.
 * @returns The tables.
 */
function tablesOf(state: LayoutState, yoga: Yoga): StyleTables {
  const tables = state.tables;

  if (tables !== undefined && tables.yoga === yoga) return tables;

  const built = styleTablesOf(yoga);

  state.tables = built;

  return built;
}

/**
 * Creates the node of an element and counts it, with the kept record of a fresh node.
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
  state.kept.set(node, freshKept(tablesOf(state, state.yoga)));
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
  state.kept.delete(node);
  state.byEntity.delete(element.entity);
  state.nodes -= 1;
}

/**
 * Re-places the children of one parent: remove all, insert in order. Once per parent per
 * reconcile — per exiting child it made a thousand-row churn quadratic (spike P4, point 4). An
 * `<anchor>` is left out: its node is a tree of its own, which the anchor pass lays out at the
 * size of its targets, so it takes no room in the flow of its parent.
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

    if (childNode === undefined || child.type === ANCHOR) continue;

    node.insertChild(childNode, index);
    index += 1;
  }
}

/**
 * Puts new children after the ones a parent's node holds, in order, and touches none of those: the
 * rest of a list made in parts costs one insert a child, where `placeChildren` takes out and puts
 * back every child placed before (F201). An `<anchor>` is left out, as `placeChildren` leaves it.
 *
 * @param state - The layout state.
 * @param parent - The element whose child list grew at its end.
 * @param children - The new children only, in child order.
 */
export function appendChildren(
  state: LayoutState,
  parent: Element,
  children: readonly Element[]
): void {
  const node = state.byEntity.get(parent.entity);

  if (node === undefined) return;

  let index = node.getChildCount();

  for (const child of children) {
    const childNode = state.byEntity.get(child.entity);

    if (childNode === undefined || child.type === ANCHOR) continue;

    node.insertChild(childNode, index);
    index += 1;
  }
}
