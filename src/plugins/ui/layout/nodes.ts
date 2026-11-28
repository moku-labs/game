/**
 * @file ui/layout — the lifetime of a Yoga node: one per ui entity, inserted into its parent
 * when the element enters, removed before it is freed. `nodes` is attach minus detach.
 */
import type { Yoga, Node as YogaNode } from "yoga-layout/load";
import type { Element } from "../jsx/types";
import { ANCHOR } from "../visual";
import { freshKept, styleTablesOf } from "./apply";
import type { KeptStyle, LayoutState, StyleTables } from "./types";

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
 * The most freed nodes kept aside for the next elements. A window of a few hundred elements closes into a spare of as
 * many; a list of thousands frees the rest. Yoga's memory never shrinks, so a spare node holds no more than the
 * window that freed it held.
 */
export const SPARE_LIMIT = 4096;

/** The slots of the six extents in a kept record (width, height, min, max), kind then number. */
const FIRST_EXTENT = 28;
const LAST_EXTENT = 38;

/**
 * Creates the node of an element and counts it: a node a free put aside, with the kept record of what it holds, or a
 * new one with the kept record of a fresh node.
 *
 * @param state - The layout state.
 * @param element - The element that entered.
 * @returns The node, or `undefined` while Yoga is still loading.
 */
export function createNode(state: LayoutState, element: Element): YogaNode | undefined {
  if (state.yoga === undefined) return undefined;

  const existing = state.byEntity.get(element.entity);

  if (existing !== undefined) return existing;

  const spare = state.spare.pop();
  const spareKept = state.spareKept.pop();

  if (spare !== undefined && spareKept !== undefined) {
    unsetExtents(spare, spareKept);
    state.byEntity.set(element.entity, spare);
    state.kept.set(spare, spareKept);
    state.nodes += 1;

    return spare;
  }

  const node = state.yoga.Node.create();

  state.byEntity.set(element.entity, node);
  state.kept.set(node, freshKept(tablesOf(state, state.yoga)));
  state.nodes += 1;

  return node;
}

/**
 * Sets the extents a node taken back still holds to what a node Yoga just made holds: a width and a height of `auto`,
 * the four min and max unset. A style that leaves an extent out writes nothing, so the width of the element that freed
 * the node would stay. The kept record goes back to the fresh one's: a point of `NaN`.
 *
 * @param node - The node taken back.
 * @param kept - Its kept record.
 */
function unsetExtents(node: YogaNode, kept: KeptStyle): void {
  for (let slot = FIRST_EXTENT; slot <= LAST_EXTENT; slot += 2) {
    if (kept[slot] === 0 && Number.isNaN(kept[slot + 1])) continue;

    kept[slot] = 0;
    kept[slot + 1] = Number.NaN;
    unsetExtent(node, slot);
  }
}

/**
 * Sets one extent of a node to what a fresh node holds.
 *
 * @param node - The node.
 * @param slot - The extent's first slot in a kept record.
 */
function unsetExtent(node: YogaNode, slot: number): void {
  switch (slot) {
    case FIRST_EXTENT: {
      node.setWidthAuto();
      break;
    }
    case FIRST_EXTENT + 2: {
      node.setHeightAuto();
      break;
    }
    case FIRST_EXTENT + 4: {
      node.setMinWidth(Number.NaN);
      break;
    }
    case FIRST_EXTENT + 6: {
      node.setMinHeight(Number.NaN);
      break;
    }
    case FIRST_EXTENT + 8: {
      node.setMaxWidth(Number.NaN);
      break;
    }
    default: {
      node.setMaxHeight(Number.NaN);
    }
  }
}

/**
 * Frees every node the spare holds, as `ui` stops: the next start loads Yoga again.
 *
 * @param state - The layout state.
 */
export function freeSpare(state: LayoutState): void {
  for (const node of state.spare) node.free();

  state.spare.length = 0;
  state.spareKept.length = 0;
}

/**
 * Takes an element out of its parent's node, which is what makes it leave the flow at once.
 *
 * @param state - The layout state.
 * @param element - The element that exits.
 */
export function detachNode(state: LayoutState, element: Element): void {
  const node = state.byEntity.get(element.entity);

  if (node === undefined) return;

  // The parent a placement put it in is known; a node placed some other way is asked for its parent.
  const parent = state.parents.get(node) ?? node.getParent() ?? undefined;

  if (parent === undefined) return;

  // eslint-disable-next-line unicorn/prefer-dom-node-remove -- a Yoga node is not a DOM node.
  parent.removeChild(node);
  unplace(state, parent, node);
}

/**
 * Takes one child out of the record of what its parent's node holds, keeping the order of the rest.
 *
 * @param state - The layout state.
 * @param parent - The parent's node.
 * @param child - The child's node, just removed.
 */
function unplace(state: LayoutState, parent: YogaNode, child: YogaNode): void {
  state.parents.delete(child);

  const placed = state.placed.get(parent);

  if (placed === undefined) return;

  const at = placed.indexOf(child);

  if (at === -1) return;

  // Per detached child: the rest move up one, with no array cut out.
  for (let index = at; index < placed.length - 1; index += 1)
    placed[index] = placed[index + 1] as YogaNode;
  placed.pop();
}

/**
 * Frees the node of an element, after it left its parent: `free()` on an attached node throws. The node is put aside
 * for the next element while the spare holds fewer than `SPARE_LIMIT`.
 *
 * @param state - The layout state.
 * @param element - The element that despawns.
 */
export function freeNode(state: LayoutState, element: Element): void {
  const node = state.byEntity.get(element.entity);

  if (node === undefined) return;

  detachNode(state, element);

  const kept = state.kept.get(node);
  const aside = kept !== undefined && state.spare.length < SPARE_LIMIT;

  // A measured node is marked dirty while it still has its function (Yoga refuses it on any other node): the size
  // Yoga cached for this element is not served to the next one.
  if (aside && state.measuring.has(node)) node.markDirty();
  // eslint-disable-next-line unicorn/no-null -- Yoga clears a measure function with null.
  node.setMeasureFunc(null);
  state.measuring.delete(node);
  forgetPlaced(state, node);
  if (aside) {
    removeChildren(node);
    state.spare.push(node);
    state.spareKept.push(kept);
  } else node.free();
  state.kept.delete(node);
  state.byEntity.delete(element.entity);
  state.nodes -= 1;
}

/**
 * Takes every child out of a node put aside: the next element gets it empty.
 *
 * @param node - The node.
 */
function removeChildren(node: YogaNode): void {
  for (let index = node.getChildCount() - 1; index >= 0; index -= 1) {
    // eslint-disable-next-line unicorn/prefer-dom-node-remove -- a Yoga node is not a DOM node.
    node.removeChild(node.getChild(index));
  }
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

  const placed = takeOut(state, node);
  let index = 0;

  for (const child of children) {
    const childNode = state.byEntity.get(child.entity);

    if (childNode === undefined || child.type === ANCHOR) continue;

    node.insertChild(childNode, index);
    placed.push(childNode);
    state.parents.set(childNode, node);
    index += 1;
  }
}

/**
 * Takes every child out of a parent's node: through the record of what it holds while that record counts as many as
 * Yoga does, else by asking Yoga for each child. The record is left empty, for the children put back.
 *
 * @param state - The layout state.
 * @param node - The parent's node.
 * @returns The emptied record of its children.
 */
function takeOut(state: LayoutState, node: YogaNode): YogaNode[] {
  const placed = state.placed.get(node) ?? noChildren();
  const count = node.getChildCount();

  if (placed.length === count) {
    for (let index = count - 1; index >= 0; index -= 1) {
      const child = placed[index] as YogaNode;

      // eslint-disable-next-line unicorn/prefer-dom-node-remove -- a Yoga node is not a DOM node.
      node.removeChild(child);
      state.parents.delete(child);
    }
  } else {
    for (const child of placed) state.parents.delete(child);
    for (let index = count - 1; index >= 0; index -= 1) {
      // eslint-disable-next-line unicorn/prefer-dom-node-remove -- a Yoga node is not a DOM node.
      node.removeChild(node.getChild(index));
    }
  }

  // `pop` and not `length = 0`: the record keeps its storage for the children put back.
  while (placed.length > 0) placed.pop();
  state.placed.set(node, placed);

  return placed;
}

/**
 * A new, empty record of the children of a node. Its own function, because lint rule L5 refuses a collection built
 * inside an exported declaration.
 *
 * @returns An empty list.
 */
function noChildren(): YogaNode[] {
  return [];
}

/**
 * Forgets what a node that is freed held and where it sat: its record of children, and the parent entry of each.
 *
 * @param state - The layout state.
 * @param node - The node about to be freed, already out of its parent.
 */
function forgetPlaced(state: LayoutState, node: YogaNode): void {
  const placed = state.placed.get(node);

  if (placed !== undefined) for (const child of placed) state.parents.delete(child);
  state.placed.delete(node);
  state.parents.delete(node);
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
  const placed = state.placed.get(node);
  // The record of what it holds stays good only while it counted every child already in.
  const tracked = placed !== undefined && placed.length === index;

  for (const child of children) {
    const childNode = state.byEntity.get(child.entity);

    if (childNode === undefined || child.type === ANCHOR) continue;

    node.insertChild(childNode, index);
    if (tracked) {
      placed.push(childNode);
      state.parents.set(childNode, node);
    }
    index += 1;
  }
}
