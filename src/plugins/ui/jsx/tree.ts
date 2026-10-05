/**
 * @file ui/jsx — `tree()`: the live screen as plain data. A pure reader over the state, so it
 * answers in plain Bun with no renderer at all.
 */
import { parseTags } from "../../text/tags";
import type { Warn } from "../../text/types";
import type { Entity } from "../../world/types";
import { fieldValue } from "./fields";
import type { Element, JsxState, Root, UiNode } from "./types";
import { isOwnKey } from "./window";

/** Reads the string `text` resolved for an entity: `Text.resolved`, empty before its first frame. */
type ResolvedOf = (entity: Entity) => string | undefined;

/**
 * The warning a tree read drops: `text` already reported a bad tag when it resolved the label.
 */
function quiet(): void {
  // Nothing to write: the text plugin warned once when it resolved the string.
}

/** What `tree()` answers with when nothing is mounted. */
const EMPTY: UiNode = {
  key: undefined,
  type: "screen",
  rect: { x: 0, y: 0, w: 0, h: 0 },
  style: {},
  state: {
    pressed: false,
    hover: false,
    focus: false,
    disabled: false,
    active: false,
    selected: false,
    covered: false
  },
  children: []
};

/**
 * The words of a tagged string, as a reader sees them: the text of every run joined, the tags
 * and the icons left out.
 *
 * @param source - A resolved string, or a plain `content` prop.
 * @returns The plain string.
 * @example
 * ```ts
 * plainOf("<b>+5</b> <icon=hud.coin>"); // "+5 "
 * ```
 */
function plainOf(source: string): string {
  let plain = "";

  for (const run of parseTags(source, quiet satisfies Warn)) {
    if (run.kind === "text") plain += run.text;
  }

  return plain;
}

/**
 * The text a text element draws: the string `text` resolved for its entity, after `tr()` and
 * binds, else its `content` prop when that is a plain string, as before its first frame.
 *
 * @param element - The element to read.
 * @param resolvedOf - Reads the resolved string of an entity; none for a tree read without a world.
 * @returns The plain string, or `undefined` for any other element and for an empty text.
 */
function contentOf(element: Element, resolvedOf: ResolvedOf | undefined): string | undefined {
  if (element.type !== "text") return undefined;

  const resolved = resolvedOf?.(element.entity);
  const source = resolved === undefined || resolved === "" ? element.node.props.content : resolved;
  const plain = typeof source === "string" ? plainOf(source) : "";

  return plain === "" ? undefined : plain;
}

/**
 * Turns one element and its subtree into snapshot nodes. The rect is natural; a fitted element
 * adds the scale it is drawn at; a text adds the words it draws; a text field adds its value; a
 * windowed scroll adds its window. The spacers of a windowed scroll are left out: its content
 * lists the live rows.
 *
 * @param state - The jsx state.
 * @param element - The element to read.
 * @param resolvedOf - Reads the resolved string of a text entity; none in a read without a world.
 * @returns The node, with its children in child order.
 */
function nodeOf(state: JsxState, element: Element, resolvedOf: ResolvedOf | undefined): UiNode {
  // The children, in child order; the spacers of a windowed scroll are skipped.
  const children: UiNode[] = [];

  for (const child of element.children) {
    const childElement = state.elements.get(child);

    if (childElement !== undefined && !isOwnKey(childElement.key)) {
      children.push(nodeOf(state, childElement, resolvedOf));
    }
  }

  // The base node every element has: key, type, natural rect, style, state flags, children.
  const node: UiNode = {
    key: element.key,
    type: element.type,
    rect: { ...element.rect },
    style: element.style,
    state: { ...element.is },
    children
  };

  // The optional fields, each only when it applies: the words of a text, the fit scale of a
  // fitted element, the value of a text field, the window of a windowed scroll, the local of a
  // component root.
  const content = contentOf(element, resolvedOf);
  const worded = content === undefined ? node : { ...node, content };
  const fitted = element.style.fit === "contain" ? { ...worded, fitScale: element.fit } : worded;
  const field = state.fields.get(element.entity);
  const valued = field === undefined ? fitted : { ...fitted, value: fieldValue(state, field) };
  const window = element.window;
  const windowed =
    window === undefined
      ? valued
      : { ...valued, window: { first: window.first, last: window.last, rows: window.rows } };
  const local =
    element.instance === undefined ? undefined : state.instances.get(element.instance)?.local;

  return local === undefined ? windowed : { ...windowed, local: { ...local } };
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
 * @param resolvedOf - Reads the string `text` resolved for an entity; none in a read without a world.
 * @returns One root node, or every root under a `screen` node.
 * @example
 * ```ts
 * readTree({ roots: new Map(), elements: new Map() } as unknown as JsxState).type; // "screen"
 * ```
 */
export function readTree(
  state: JsxState,
  layers: readonly string[] = [],
  resolvedOf?: ResolvedOf
): UiNode {
  const nodes: UiNode[] = [];

  for (const root of sortedRoots(state, layers)) {
    const element = root.element === undefined ? undefined : state.elements.get(root.element);

    if (element !== undefined) nodes.push(nodeOf(state, element, resolvedOf));
  }

  const single = nodes.length === 1 ? nodes[0] : undefined;

  if (single !== undefined) return single;
  if (nodes.length === 0) return EMPTY;

  return { ...EMPTY, children: nodes };
}
