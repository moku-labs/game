/**
 * @file ui/jsx — `tree()`: the live screen as plain data. A pure reader over the state, so it
 * answers in plain Bun with no renderer at all.
 */
import type { Element, JsxState, Root, UiNode } from "./types";

/** What `tree()` answers with when nothing is mounted. */
const EMPTY: UiNode = {
  key: undefined,
  type: "screen",
  rect: { x: 0, y: 0, w: 0, h: 0 },
  style: {},
  state: { pressed: false, disabled: false, active: false, selected: false },
  children: []
};

/**
 * Turns one element and its subtree into snapshot nodes.
 *
 * @param state - The jsx state.
 * @param element - The element to read.
 * @returns The node, with its children in child order.
 */
function nodeOf(state: JsxState, element: Element): UiNode {
  const children: UiNode[] = [];

  for (const child of element.children) {
    const childElement = state.elements.get(child);

    if (childElement !== undefined) children.push(nodeOf(state, childElement));
  }

  const local =
    element.instance === undefined ? undefined : state.instances.get(element.instance)?.local;
  const node: UiNode = {
    key: element.key,
    type: element.type,
    rect: { ...element.rect },
    style: element.style,
    state: { ...element.is },
    children
  };

  return local === undefined ? node : { ...node, local: { ...local } };
}

/**
 * Every mounted root in the order a reader meets them: the popup roots first, the highest `Order`
 * of them first, then the projection roots in the layer order of the scene.
 *
 * @param state - The jsx state.
 * @param layers - The layer names of the scene, in draw order.
 * @returns The roots, sorted.
 * @example
 * ```ts
 * sortedRoots({ roots: new Map() } as unknown as JsxState, ["ui"]); // []
 * ```
 */
export function sortedRoots(state: JsxState, layers: readonly string[]): Root[] {
  const roots = [...state.roots.values()];
  const popups = roots.filter(root => root.popup !== undefined);
  const screens = roots.filter(root => root.popup === undefined);
  const indexOf = (root: Root): number => {
    const index = layers.indexOf(root.layer);

    return index === -1 ? layers.length : index;
  };

  popups.sort((first, second) => second.order - first.order);
  screens.sort((first, second) => indexOf(first) - indexOf(second));

  return [...popups, ...screens];
}

/**
 * Reads every mounted root, popups first, then the projection roots in layer order.
 *
 * @param state - The jsx state.
 * @param layers - The layer names of the scene, in draw order.
 * @returns One root node, or every root under a `screen` node.
 * @example
 * ```ts
 * readTree({ roots: new Map(), elements: new Map() } as unknown as JsxState).type; // "screen"
 * ```
 */
export function readTree(state: JsxState, layers: readonly string[] = []): UiNode {
  const nodes: UiNode[] = [];

  for (const root of sortedRoots(state, layers)) {
    const element = root.element === undefined ? undefined : state.elements.get(root.element);

    if (element !== undefined) nodes.push(nodeOf(state, element));
  }

  const single = nodes.length === 1 ? nodes[0] : undefined;

  if (single !== undefined) return single;
  if (nodes.length === 0) return EMPTY;

  return { ...EMPTY, children: nodes };
}
