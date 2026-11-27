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

  // SPIKE hp-2ab: a node freed before is taken back with the Yoga values it holds and its kept record of them.
  const pooled = spikeOn() ? poolOf(state).pop() : undefined;

  if (pooled !== undefined) {
    spikeUnsetExtents(pooled.node, pooled.kept);
    state.byEntity.set(element.entity, pooled.node);
    state.kept.set(pooled.node, pooled.kept);
    state.nodes += 1;

    return pooled.node;
  }

  const node = state.yoga.Node.create();

  state.byEntity.set(element.entity, node);
  state.kept.set(node, freshKept(tablesOf(state, state.yoga)));
  state.nodes += 1;

  return node;
}

/** SPIKE hp-2ab: the freed nodes kept for the next element, with their kept records. */
const SPIKE_POOLS = new WeakMap<LayoutState, { node: YogaNode; kept: Float64Array }[]>();

/** SPIKE hp-2ab: the pool of one layout state, whose Yoga module made its nodes. */
function poolOf(state: LayoutState): { node: YogaNode; kept: Float64Array }[] {
  let pool = SPIKE_POOLS.get(state);

  if (pool === undefined) {
    pool = [];
    SPIKE_POOLS.set(state, pool);
  }

  return pool;
}

/**
 * SPIKE hp-2ab: a style that writes no extent leaves it alone, which reads "unset" only on a fresh node: the six
 * extents a pooled node still holds are unset here (slots 28–38 of the kept record, kind then number).
 */
function spikeUnsetExtents(node: YogaNode, kept: Float64Array): void {
  for (let slot = 28; slot <= 38; slot += 2) {
    if (kept[slot] === 0 && Number.isNaN(kept[slot + 1])) continue;

    kept[slot] = 0;
    kept[slot + 1] = Number.NaN;
    if (slot === 28) node.setWidth(Number.NaN);
    else if (slot === 30) node.setHeight(Number.NaN);
    else if (slot === 32) node.setMinWidth(Number.NaN);
    else if (slot === 34) node.setMinHeight(Number.NaN);
    else if (slot === 36) node.setMaxWidth(Number.NaN);
    else node.setMaxHeight(Number.NaN);
  }
}

/** SPIKE hp-2ab: whether the pool is on (`globalThis.__hp2ab`). */
function spikeOn(): boolean {
  return ((globalThis as { __hp2ab?: boolean }).__hp2ab ?? (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.HP2AB === "1") === true;
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
 * Frees the node of an element, after it left its parent: `free()` on an attached node throws.
 *
 * @param state - The layout state.
 * @param element - The element that despawns.
 */
export function freeNode(state: LayoutState, element: Element): void {
  const node = state.byEntity.get(element.entity);

  if (node === undefined) return;

  detachNode(state, element);

  const kept = state.kept.get(node);
  const pool = spikeOn() && kept !== undefined && poolOf(state).length < 4096;

  // SPIKE hp-2ab: a measured node is marked dirty before its function goes, so its cached size is not served again.
  if (pool && state.measuring.has(node)) node.markDirty();
  // eslint-disable-next-line unicorn/no-null -- Yoga clears a measure function with null.
  node.setMeasureFunc(null);
  state.measuring.delete(node);
  forgetPlaced(state, node);
  if (pool) {
    for (let index = node.getChildCount() - 1; index >= 0; index -= 1) {
      // eslint-disable-next-line unicorn/prefer-dom-node-remove -- a Yoga node is not a DOM node.
      node.removeChild(node.getChild(index));
    }
    poolOf(state).push({ node, kept });
  } else node.free();
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
