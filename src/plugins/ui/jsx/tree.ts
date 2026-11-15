/**
 * @file ui/jsx — `tree()`: the live screen as plain data. A pure reader over the state, so it
 * answers in plain Bun with no renderer at all.
 */
import type { TransformValue } from "../../renderer/components";
import { parseTags } from "../../text/tags";
import type { Warn } from "../../text/types";
import type { Entity } from "../../world/types";
import type { Rect } from "../layout/types";
import { drawnRect, namedKeyOf, namesFormat } from "../visual";
import { fieldValue } from "./fields";
import type { AsideOf, Element, JsxState, Root, UiNode } from "./types";
import { isOwnKey } from "./window";

/** Reads the string `text` resolved for an entity: `Text.resolved`, empty before its first frame. */
type ResolvedOf = (entity: Entity) => string | undefined;

/** Reads the style an entity is drawn in: `Text.style`, nothing before it carries its `Text`. */
type ShownStyleOf = (entity: Entity) => string | undefined;

/** Reads the stops a `snap` prop names inside 0 to `max`: `stopsOf` of the layout module. */
type StopsOf = (snap: unknown, max: number) => number[] | undefined;

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
 * The text style key of a text element: the style a format of the game answered, for a text whose
 * bind names one; else the key its style object took for this frame (F182); else the `style` prop
 * while that is a key.
 *
 * @param element - The element to read.
 * @param shownStyleOf - Reads `Text.style` of an entity; none for a tree read without a world.
 * @returns The key, or `undefined` for any other element and for a text whose style names none.
 */
function textStyleOf(element: Element, shownStyleOf: ShownStyleOf | undefined): string | undefined {
  if (element.type !== "text") return undefined;

  const shown = namesFormat(element) ? shownStyleOf?.(element.entity) : undefined;

  if (shown !== undefined) return shown;

  return namedKeyOf(element.style, element.node.props.style);
}

/**
 * The id of the motion an element was given: the `id` of its `motion` prop when that is an object
 * with a string `id`, which `defineMotion({ id })` sets.
 *
 * @param element - The element to read.
 * @returns The id, or `undefined` for an element without a motion and for a motion without an id.
 */
function motionIdOf(element: Element): string | undefined {
  const motion: unknown = element.node.props.motion;

  if (typeof motion !== "object" || motion === null) return undefined;

  return "id" in motion && typeof motion.id === "string" ? motion.id : undefined;
}

/**
 * Where a scroll stands and how it rests: the values `ScrollState` carries (the offset in whole
 * units, `max`, whether it moves), all 0 and false until the first solve placed it, with its axis
 * and the stops of its `snap` prop a release would use.
 *
 * @param element - The element to read.
 * @param stopsOf - Reads the stops of a `snap` prop; none in a read without a layout, which leaves `snap` out.
 * @returns The scroll record, or `undefined` for an element that is no scroll.
 */
function scrollOf(element: Element, stopsOf: StopsOf | undefined): UiNode["scroll"] {
  const motion = element.scroll;

  if (motion === undefined) return undefined;

  const max = motion.placed ? motion.max : 0;
  const shown = {
    axis: motion.axis,
    offset: motion.placed ? Math.round(motion.offset) : 0,
    max,
    moving: motion.placed && motion.mode !== "still"
  };
  const snap = stopsOf?.(element.node.props.snap, max);

  return snap === undefined ? shown : { ...shown, snap };
}

/**
 * Turns one element and its subtree into snapshot nodes. The rect is natural; a fitted element
 * adds the scale it is drawn at; a text adds the words it draws and the style key of a keyed
 * text; a text field adds its value; a windowed scroll adds its window; an element with a
 * motion id adds it, a scroll adds where it stands and its snap stops. The spacers of a windowed
 * scroll are left out: its content lists the live rows. The rects of a root laid out in a slot are
 * in the slot's units: `place` maps them into root coordinates.
 *
 * @param state - The jsx state.
 * @param element - The element to read.
 * @param resolvedOf - Reads the resolved string of a text entity; none in a read without a world.
 * @param shownStyleOf - Reads `Text.style` of a text entity; none in a read without a world.
 * @param stopsOf - Reads the stops of a `snap` prop; none in a read without a layout.
 * @param place - Maps a rect of a slotted root into root coordinates; none for a root on the viewport.
 * @returns The node, with its children in child order.
 */
function nodeOf(
  state: JsxState,
  element: Element,
  resolvedOf: ResolvedOf | undefined,
  shownStyleOf: ShownStyleOf | undefined,
  stopsOf: StopsOf | undefined,
  place?: (rect: Rect) => Rect
): UiNode {
  // The children, in child order; the spacers of a windowed scroll are skipped.
  const children: UiNode[] = [];

  for (const child of element.children) {
    const childElement = state.elements.get(child);

    if (childElement !== undefined && !isOwnKey(childElement.key)) {
      children.push(nodeOf(state, childElement, resolvedOf, shownStyleOf, stopsOf, place));
    }
  }

  // The base node every element has: key, type, natural rect, style, state flags, children.
  const node: UiNode = {
    key: element.key,
    type: element.type,
    rect: place === undefined ? { ...element.rect } : place(element.rect),
    style: element.style,
    state: { ...element.is },
    children
  };

  // The optional fields, each only when it applies: the words of a text, the style key of a keyed
  // text, the fit scale of a fitted element, the value of a text field, the window of a windowed
  // scroll, the local of a component root, the motion id of a motion, the scroll record of a scroll.
  const content = contentOf(element, resolvedOf);
  const worded = content === undefined ? node : { ...node, content };
  const textStyle = textStyleOf(element, shownStyleOf);
  const styled = textStyle === undefined ? worded : { ...worded, textStyle };
  const fitted = element.style.fit === "contain" ? { ...styled, fitScale: element.fit } : styled;
  const field = state.fields.get(element.entity);
  const valued = field === undefined ? fitted : { ...fitted, value: fieldValue(state, field) };
  const window = element.window;
  const windowed =
    window === undefined
      ? valued
      : { ...valued, window: { first: window.first, last: window.last, rows: window.rows } };
  const local =
    element.instance === undefined ? undefined : state.instances.get(element.instance)?.local;

  const located = local === undefined ? windowed : { ...windowed, local: { ...local } };

  // The motion id and the scroll record come last, each only when the element has one.
  const motion = motionIdOf(element);
  const motioned = motion === undefined ? located : { ...located, motion };
  const scroll = scrollOf(element, stopsOf);

  return scroll === undefined ? motioned : { ...motioned, scroll };
}

/**
 * Every mounted root in the order a reader meets them: the popup roots first, the highest `Order`
 * of them first, then the projection roots in the layer order of the scene, and by their `Order`
 * inside one layer, bottom first, as they draw. A root of the scene `world` builds aside is left
 * out until the swap: nothing of it is on the screen yet (spec 31).
 *
 * @param state - The jsx state.
 * @param layers - The layer names of the scene, in draw order.
 * @param isAside - Whether an entity belongs to the scene built aside; none leaves no root out.
 * @returns The roots, sorted.
 * @example
 * ```ts
 * sortedRoots({ roots: new Map() } as unknown as JsxState, ["ui"]); // []
 * ```
 */
export function sortedRoots(state: JsxState, layers: readonly string[], isAside?: AsideOf): Root[] {
  const roots = [...state.roots.values()].filter(
    root => isAside === undefined || !isAside(root.entity)
  );
  const popups = roots.filter(root => root.popup !== undefined);
  const screens = roots.filter(root => root.popup === undefined);
  const indexOf = (root: Root): number => {
    const index = layers.indexOf(root.layer);

    return index === -1 ? layers.length : index;
  };

  popups.sort((first, second) => second.order - first.order);
  // Inside one layer the roots are listed as they draw: by their order (spec 16 U1.6).
  screens.sort((first, second) => indexOf(first) - indexOf(second) || first.order - second.order);

  return [...popups, ...screens];
}

/**
 * How the rects of one root reach root coordinates: unchanged on the viewport, through the root
 * pose of its slot for a root laid out in one.
 *
 * @param root - The root.
 * @param slotPose - The root pose of a slot; none in a read without a world.
 * @returns The mapping, or `undefined` when the rects are root coordinates already.
 */
function placeOf(
  root: Root,
  slotPose: ((slot: Entity) => TransformValue) | undefined
): ((rect: Rect) => Rect) | undefined {
  if (root.slot === undefined || slotPose === undefined) return undefined;

  const pose = slotPose(root.slot);

  return (rect: Rect): Rect => drawnRect(pose, rect);
}

/**
 * Reads every mounted root, popups first, then the projection roots in layer order, and none of the
 * scene `world` builds aside. The rects of a root laid out in a slot are reported in root
 * coordinates, through the root pose of its slot.
 *
 * @param state - The jsx state.
 * @param layers - The layer names of the scene, in draw order.
 * @param resolvedOf - Reads the string `text` resolved for an entity; none in a read without a world.
 * @param slotPose - The root pose of a slot, `rootPoseOf` of `renderer`; none in a read without a world.
 * @param isAside - Whether an entity belongs to the scene `world` builds aside: such a root is not read.
 * @param shownStyleOf - Reads `Text.style` of an entity; none in a read without a world.
 * @param stopsOf - `stopsOf` of the layout module, which clamps the `snap` stops of a scroll; none in a read without a layout.
 * @returns One root node, or every root under a `screen` node.
 * @example
 * ```ts
 * readTree({ roots: new Map(), elements: new Map() } as unknown as JsxState).type; // "screen"
 * ```
 */
export function readTree(
  state: JsxState,
  layers: readonly string[] = [],
  resolvedOf?: ResolvedOf,
  slotPose?: (slot: Entity) => TransformValue,
  isAside?: AsideOf,
  shownStyleOf?: ShownStyleOf,
  stopsOf?: StopsOf
): UiNode {
  const nodes: UiNode[] = [];

  for (const root of sortedRoots(state, layers, isAside)) {
    const element = root.element === undefined ? undefined : state.elements.get(root.element);

    if (element !== undefined)
      nodes.push(
        nodeOf(state, element, resolvedOf, shownStyleOf, stopsOf, placeOf(root, slotPose))
      );
  }

  const single = nodes.length === 1 ? nodes[0] : undefined;

  if (single !== undefined) return single;
  if (nodes.length === 0) return EMPTY;

  return { ...EMPTY, children: nodes };
}
