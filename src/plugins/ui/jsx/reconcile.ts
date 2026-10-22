/**
 * @file ui/jsx — the reconcile: a description tree diffed by identity into the entities `ui`
 * owns, and the solve that gives every one of them its rect before it is ever drawn. An element
 * that stays is compared prop by prop, by value: one that says what it said is neither styled nor
 * written. Beside it:
 * the range of a windowed scroll (`range.ts`), the rest and the motion of the extras
 * (`extras.ts`), the hint routed to a keyed element (`hints.ts`) and the remeasure of the texts
 * `text` resolved again (`remeasure.ts`).
 */
import { printOf } from "../../anim/motion";
import { PointerOver, Pressed, Scrollable, Tappable, Touchable } from "../../input/components";
import type { Json } from "../../model/types";
import {
  NineSlice,
  OverlayLevel,
  Parent,
  Shape,
  Sprite,
  Transform,
  type TransformValue
} from "../../renderer/components";
import { Text } from "../../text/components";
import type { Time } from "../../time/types";
import { Exiting, Layer, Order, Tree as WORLD_TREE } from "../../world/ecs/define";
import type {
  AnyComponentType,
  AnyComponentValue,
  Entity,
  LayerSpec,
  MotionCause,
  MotionHandle
} from "../../world/types";
import {
  Box,
  Escapable,
  LocalWrite,
  Scroll,
  ScrollState,
  UI_OWNER,
  UiCounters
} from "../components";
import { asError, asHandle } from "../errors";
import type { LayoutModule, Rect } from "../layout/types";
import type { IsFlags, ResolvedStyle, Style, StylesModule } from "../styles/types";
import type { UiCtx } from "../types";
import { CONTENT, visualOf } from "../visual";
import { cancelExtra, livePatch, recordRest } from "./extras";
import type { Fields } from "./fields";
import { hintOf } from "./hints";
import { dropHost, hostsMoved, hostsOf, hostViews, slotFor, slotOf, trackHost } from "./hosts";
import { forgetInstances, instanceFor, runView } from "./instances";
import { childOrder, SIBLING_SPAN } from "./order";
import { createSpan, enterOverlay, exitOverlay, overlayOf, settleOverlays } from "./overlay";
import { settlePopups } from "./popups";
import { createRange } from "./range";
import { markResizedIcons, markResizedTexts } from "./remeasure";
import { sameValue } from "./same";
import type {
  DescriptionNode,
  Element,
  ElementMotion,
  JsxState,
  PointerFlag,
  PopupLink,
  Root,
  ScrollMotion
} from "./types";
import { axisOf, checkWindow, isOwnKey, scrollMotionOf } from "./window";

/** What the modules injected into `jsx` are. */
export type JsxModules = { styles: StylesModule; layout: LayoutModule };

/** The four components an element may be drawn with; a state change can trade one for another. */
const VISUALS: readonly AnyComponentType[] = [Sprite, NineSlice, Shape, Text];

/**
 * The input components of an element and the Escape marker; a disabled or covered button drops
 * the answering one and the marker. A scroll's three hold its runtime state.
 */
const INPUTS: readonly AnyComponentType[] = [
  Tappable,
  Touchable,
  LocalWrite,
  Scroll,
  Scrollable,
  ScrollState,
  Escapable
];

/** The components of a scroll that hold where it stands: added once, never patched by a render. */
const SCROLL_STATE: ReadonlySet<string> = namesOf([Scroll, Scrollable, ScrollState]);

/**
 * One list of the visual and the input types. Its own function, because lint rule L5 refuses a
 * collection built in a module-scope declaration.
 *
 * @param lists - The lists, in order.
 * @returns Their types, in order.
 */
function concatTypes(...lists: ReadonlyArray<readonly AnyComponentType[]>): AnyComponentType[] {
  return lists.flat();
}

/** Every type a live element may carry and drop again: the visuals, then the inputs. */
const LIVE_TYPES: readonly AnyComponentType[] = concatTypes(VISUALS, INPUTS);

/** The owned fields of a type that gives none to a plugin: one list, never a new one. */
const NO_OWNED: readonly string[] = [];

/** The time of a reconcile a test steps by hand: no ms pass, so no scroll moves. */
const NO_TIME: Readonly<Time> = Object.freeze({
  delta: 0,
  elapsed: 0,
  scale: 1,
  frame: 0,
  idle: false
});

/**
 * Tells whether a list of component values holds one of a type.
 *
 * @param values - The values.
 * @param type - The type.
 * @returns True when a value of that type is there.
 */
function carries(values: readonly AnyComponentValue[], type: AnyComponentType): boolean {
  // Per restyle, nine times: an index loop, which allocates nothing in every tier of V8 (measured).
  // eslint-disable-next-line unicorn/no-for-loop -- the iterator of `for…of` is not always optimised away here.
  for (let index = 0; index < values.length; index += 1) {
    if (values[index]?.type === type) return true;
  }

  return false;
}

/**
 * The names of a list of component types. Its own function, because lint rule L5 refuses a
 * collection built in a module-scope declaration.
 *
 * @param types - The component and tag types.
 * @returns Their names.
 */
function namesOf(types: readonly AnyComponentType[]): ReadonlySet<string> {
  return new Set(types.map(type => type.componentName));
}

/**
 * The components an element writes or reads on its own entity: the reconcile's own, every visual
 * and input it may trade for another, the exit tag, and the two pointer tags `input` writes. A
 * value of the `components` prop of one of these types is dropped, never written.
 */
export const ELEMENT_OWNED: ReadonlySet<string> = namesOf([
  Transform,
  Box,
  Layer,
  Order,
  Parent,
  ...VISUALS,
  ...INPUTS,
  Exiting,
  Pressed,
  PointerOver
]);

/** The style of a scroll's content: one object, so a render never reads as a new style. */
const CONTENT_STYLE: Style = Object.freeze({ origin: "topLeft" });

/** The style of an x scroll's content: its children stand side by side. */
const CONTENT_ROW_STYLE: Style = Object.freeze({ origin: "topLeft", direction: "row" });

/**
 * The props, besides `style`, `state` and `content`, that a live element is written from: `bind`,
 * `texture`, `name` and `fit` reach its visual, `intent`, `payload`, `local` and `escape` its
 * input, `components` its extras and `motion` its hooks. Every other prop is read from the node
 * where it is used, at every patch: `hosts`, the props of a windowed scroll, the props of a text
 * field, and the children.
 */
const WRITTEN: readonly string[] = [
  "bind",
  "texture",
  "name",
  "fit",
  "components",
  "motion",
  "intent",
  "payload",
  "local",
  "escape"
];

/**
 * The state flags that do not come from the markup: the pointer's two, the keyboard's one and
 * the root's one.
 */
type LiveFlags = Pick<IsFlags, "pressed" | "hover" | "focus" | "covered">;

/**
 * What one patch found by comparing the node of this render with the one before it.
 */
type Change = {
  /** The state flags of this render. */
  is: IsFlags;
  /** The style of this render: the object the element holds when it was kept. */
  style: ResolvedStyle;
  /** The row height the style of this render is resolved on, for a row of a windowed scroll. */
  rowHeight: number | undefined;
  /** The style was resolved again, not kept. */
  resolved: boolean;
  /** A field of the style that reaches a rect changed. */
  moved: boolean;
  /** The layout node is written and measured again: a rect, a text or what it is measured in. */
  measures: boolean;
  /** The element says what it said: nothing is styled and nothing is written. */
  unchanged: boolean;
};

/**
 * Tells whether two nodes write the same visual, input and extras: every prop of `WRITTEN` says
 * the same, as `sameValue` reads it.
 *
 * @param previous - The node the element was last patched from.
 * @param next - The node of this render.
 * @returns True when no component of the element has to be written for these props.
 * @example
 * ```ts
 * writesSame({ type: "row", props: { payload: { id: 1 } }, children: [] }, { type: "row", props: { payload: { id: 2 } }, children: [] }); // false
 * ```
 */
function writesSame(previous: DescriptionNode, next: DescriptionNode): boolean {
  return WRITTEN.every(name => sameValue(previous.props[name], next.props[name]));
}

/**
 * The children one element is diffed against. A scroll container holds exactly one of them: the
 * content the finger moves, which keeps the rects of its own children and carries them along. Its
 * pivot is its top-left corner, so the scroll step writes its offset straight into `x` or `y`; it
 * lays its children out as a column, or as a row on the `x` axis. The content of a windowed scroll
 * holds the slots of its window, the two spacers and the rows, instead of the markup's children.
 *
 * @param node - The node the markup wrote.
 * @param slots - The slots of a windowed scroll, top spacer to bottom spacer.
 * @param axis - The axis of a scroll, the one it spawned with.
 * @returns The children of the element.
 * @example
 * ```ts
 * childrenOf({ type: "scroll", props: {}, children: [] }).length; // 1
 * ```
 */
export function childrenOf(
  node: DescriptionNode,
  slots?: DescriptionNode[],
  axis: ScrollMotion["axis"] = "y"
): readonly DescriptionNode[] {
  if (node.type !== "scroll") return node.children;

  const style = axis === "x" ? CONTENT_ROW_STYLE : CONTENT_STYLE;

  return [{ type: CONTENT, props: { style }, children: slots ?? node.children }];
}

/**
 * The identity of one node: its parent, then the key or the type and index, then the type.
 *
 * @param parentIdentity - The identity of the parent element.
 * @param node - The node being placed.
 * @param index - Its position among its siblings.
 * @returns The identity the element keeps for its whole life.
 * @example
 * ```ts
 * identityOf("0", { type: "row", props: {}, children: [] }, 2); // "0|row@2|row"
 * ```
 */
export function identityOf(parentIdentity: string, node: DescriptionNode, index: number): string {
  const name = node.key ?? `${node.type}@${index}`;

  return `${parentIdentity}|${name}|${node.type}`;
}

/**
 * Gives the subtree of a component the key the component tag carried, so the element is
 * addressable under the name the markup wrote.
 *
 * @param node - What the component's view returned.
 * @param key - The key of the component tag.
 * @returns The node, keyed.
 * @example
 * ```ts
 * withKey({ type: "column", props: {}, children: [] }, "panel").key; // "panel"
 * ```
 */
export function withKey(node: DescriptionNode, key: string | undefined): DescriptionNode {
  if (key === undefined) return node;

  return { ...node, key };
}

/**
 * The state flags of an element: what the markup declared, the two flags the pointer set, the
 * keyboard focus, and the covered flag of the root it belongs to. `hover`, `focus` and `covered`
 * never come from the markup.
 *
 * @param node - The node being placed.
 * @param live - Whether the pointer presses it or is over it, whether the keyboard focused it,
 *   and whether its root is covered.
 * @param live.pressed - The pointer is down on it.
 * @param live.hover - An idle mouse or pen is over it.
 * @param live.focus - The keyboard focus is on it.
 * @param live.covered - Its root is kept under another popup.
 * @returns The seven flags.
 * @example
 * ```ts
 * isFlagsOf({ type: "button", props: { state: { active: true } }, children: [] }, { pressed: false, hover: true, focus: false, covered: false }).active; // true
 * ```
 */
export function isFlagsOf(node: DescriptionNode, live: LiveFlags): IsFlags {
  const declared = node.props.state as Partial<IsFlags> | undefined;

  return {
    pressed: live.pressed,
    hover: live.hover,
    focus: live.focus,
    disabled: declared?.disabled === true,
    active: declared?.active === true,
    selected: declared?.selected === true,
    covered: live.covered
  };
}

/**
 * The layout style of a node. A `text` whose `style` prop is a style key carries no layout style.
 *
 * @param node - The node being placed.
 * @returns The style, or `undefined`.
 */
function styleOf(node: DescriptionNode): Style | undefined {
  const style = node.props.style;

  return typeof style === "object" && style !== null ? (style as Style) : undefined;
}

/**
 * Refuses the tags that cannot be placed: a text field that names no local field, and a windowed
 * scroll whose props do not hold.
 *
 * @param node - The node being placed.
 * @throws {Error} For an `input` tag without `local`, and for a windowed scroll whose props do
 *   not hold.
 */
function checkTag(node: DescriptionNode): void {
  if (node.type === "input" && typeof node.props.local !== "string") {
    throw new Error('[game] An input needs a local field.\n  Write <input local="name" />.');
  }

  checkWindow(node);
}

/**
 * What a button that answers carries: `Tappable` with its intent, or `Touchable` and
 * `LocalWrite` with its patch, or `Touchable` alone when it names neither.
 *
 * @param node - The node of the button.
 * @returns The component values.
 */
function answerOf(node: DescriptionNode): AnyComponentValue[] {
  const intent = node.props.intent;
  const local = node.props.local;

  if (typeof intent === "string") {
    return [Tappable({ intent, payload: (node.props.payload ?? {}) as Json })];
  }

  if (typeof local === "object" && local !== null) {
    return [Touchable(), LocalWrite({ patch: local as Record<string, unknown> })];
  }

  return [Touchable()];
}

/**
 * The input components of an element: a button answers the gate, writes local state, or only
 * swallows the tap; a panel swallows the tap too, so nothing under it answers; a text field takes
 * the tap that starts its editing; a scroll container takes the press that moves its content and
 * carries where it stands, on the axis it spawned with. A button of a covered popup answers
 * nothing, so only the top popup answers the gate. A button with the `escape` prop that answers
 * also carries `Escapable`, the control the Escape key taps.
 *
 * @param element - The element to make touchable.
 * @returns The component values.
 */
function inputOf(element: Element): AnyComponentValue[] {
  const { type, node, is } = element;

  if (type === "scroll") {
    const axis = element.scroll?.axis ?? "y";

    return [Touchable(), Scroll({ axis }), Scrollable({ axis, moving: false }), ScrollState()];
  }
  if (type === "panel" || type === "input") return [Touchable()];
  if (type !== "button") return [];
  if (is.disabled || is.covered) return [Touchable()];

  const answering = answerOf(node);

  return node.props.escape === true ? [...answering, Escapable()] : answering;
}

/**
 * Creates the extras map of one element. Its own function, because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @returns An empty map.
 */
function extrasMap(): Map<string, AnyComponentValue> {
  return new Map();
}

/**
 * Creates the set of owned names an element already logged. Its own function, because lint rule
 * L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty set.
 */
function nameSet(): Set<string> {
  return new Set();
}

/**
 * Creates the map of the motions the `change` hooks of an element's extras returned. Its own
 * function, because lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty map.
 */
function handleMap(): Map<string, MotionHandle> {
  return new Map();
}

/**
 * The `components` prop of a node as the markup wrote it.
 *
 * @param node - The node of this render.
 * @returns The values, or none when the prop is left out.
 */
function listedOf(node: DescriptionNode): readonly AnyComponentValue[] {
  const listed: unknown = node.props.components;

  return Array.isArray(listed) ? (listed as readonly AnyComponentValue[]) : [];
}

/**
 * The extra components of an element: its `components` prop with every value whose type the
 * element owns dropped. Of two values of one type the last wins.
 *
 * @param element - The element, or anything that carries its node.
 * @param element.node - The node of this render.
 * @returns The values to carry, by component name.
 * @example
 * ```ts
 * [...extrasOf({ node: { type: "row", props: { components: [Transform({ x: 10 }), Held()] }, children: [] } }).keys()]; // ["Held"]
 * ```
 */
export function extrasOf(element: Pick<Element, "node">): ReadonlyMap<string, AnyComponentValue> {
  const extras = extrasMap();

  for (const value of listedOf(element.node)) {
    const name = value.type.componentName;

    if (!ELEMENT_OWNED.has(name)) extras.set(name, value);
  }

  return extras;
}

/**
 * Tells whether the loop of a new render is the loop that runs: the same hook, or two hooks
 * `defineMotion` built from the same keys, cycle and reduced-motion rule (their fingerprints are
 * equal). A hand-written hook of a new reference is another loop.
 *
 * @param previous - The loop hook the element runs, if any.
 * @param next - The loop hook of this render, if any.
 * @returns True when the running loop goes on.
 */
function sameLoop(previous: unknown, next: unknown): boolean {
  if (previous === next) return true;

  const print = printOf(previous);

  return print !== undefined && print === printOf(next);
}

/** How many patches in a row may rebuild a loop before a dev build names the element. */
const REBUILDS_WARNED = 3;

/** How many passes the solve gives the roots laid out in slots before it calls the rest a cycle. */
const SLOT_PASSES = 4;

/**
 * Tells whether a root was last solved in a box of this size and place.
 *
 * @param solved - The box it was last solved in, if any.
 * @param next - The box of this solve.
 * @returns True when nothing moved.
 * @example
 * ```ts
 * sameBox({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }); // true
 * ```
 */
function sameBox(solved: Rect | undefined, next: Rect): boolean {
  return (
    solved !== undefined &&
    solved.x === next.x &&
    solved.y === next.y &&
    solved.w === next.w &&
    solved.h === next.h
  );
}

/**
 * Tells whether two values of one component carry the same fields: shallow, `Object.is` per
 * field. A tag value is the same as another tag value.
 *
 * @param previous - The value of the previous render.
 * @param next - The value of this render.
 * @returns True when nothing has to be written.
 * @example
 * ```ts
 * sameFields({ strength: 2 }, { strength: 2 }); // true
 * ```
 */
function sameFields(previous: object | true, next: object | true): boolean {
  if (previous === true || next === true) return previous === next;

  const before = new Map<string, unknown>(Object.entries(previous));
  const after = Object.entries(next) as [string, unknown][];

  return (
    before.size === after.length &&
    after.every(([field, value]) => before.has(field) && Object.is(before.get(field), value))
  );
}

/**
 * Where the element of a root is drawn: the layer and the order of its root, and the slot it is
 * laid out in, with its place among the projections that slot hosts.
 */
export type RootPlacement = {
  layer: string;
  order: number;
  slot?: { host: Entity; order: number };
};

/**
 * Everything an entering element gets at once, so a display object never exists without a rect.
 * A child draws with its parent, always at an `Order`: its `zIndex` step and its place among its
 * siblings (`childOrder`), so siblings draw in markup order at equal `zIndex`; the root element
 * draws in the layer of its root, at its order, and ignores `zIndex`. A root element laid out in a
 * slot hangs under the slot at the place the slot lists its projection, an integer `Order` (a
 * non-element child of the slot), and keeps its layer to fall back to. The
 * extras of its `components` prop come after its own visual and input, before `Box`.
 *
 * @param element - The element whose rect, rest pose and extras are known.
 * @param root - Where the root the element belongs to draws.
 * @returns The component values the entity is filled with.
 */
export function componentsOf(element: Element, root: RootPlacement): AnyComponentValue[] {
  const values: AnyComponentValue[] = [Transform(element.rest)];

  if (element.parent === undefined) {
    values.push(Layer({ name: root.layer }), Order({ value: root.slot?.order ?? root.order }));

    if (root.slot !== undefined) values.push(Parent({ entity: root.slot.host }));
  } else {
    values.push(
      Parent({ entity: element.parent }),
      Order({ value: childOrder(element.style.zIndex, element.index) })
    );
  }

  // `Box` is last on purpose: the world applies a queued attach in call order and fires
  // `onAdded` as it goes, so the hook on `Box` is the moment the whole entity exists, extras too.
  return [
    ...values,
    ...visualOf(element),
    ...inputOf(element),
    ...element.extras.values(),
    Box(element.rect)
  ];
}

/**
 * Creates the key map of one root. Its own function, because lint rule L5 refuses a collection
 * built inside an exported declaration.
 *
 * @returns An empty key map.
 */
function keyMap(): Map<string, Entity> {
  return new Map();
}

/**
 * Tells a live element from a lookup that missed.
 *
 * @param element - What the element map answered.
 * @returns True when the element is there.
 */
function isElement(element: Element | undefined): element is Element {
  return element !== undefined;
}

/**
 * The pose a new element starts from before its first solve.
 *
 * @returns The identity transform.
 */
function identityPose(): TransformValue {
  return { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } };
}

/**
 * Collects the entities of a change set. Its own function, because lint rule L5 refuses a
 * collection built inside an exported declaration.
 *
 * @param entities - What `changed()` answered.
 * @returns The entities as a set.
 */
function entitySet(entities: Iterable<Entity>): Set<Entity> {
  return new Set(entities);
}

/**
 * Tells whether an element whose `Box` just came arrives with an enter: new, and not a row a
 * range change scrolled in.
 *
 * @param element - The element, if it is still known.
 * @returns True when its enter hook is to play.
 */
function arrives(element: Element | undefined): element is Element {
  return element !== undefined && !element.entered && !element.scrolledIn;
}

/**
 * Builds the reconcile half of the jsx module: the two systems of the frame and the root
 * bookkeeping around them.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param modules - The styles and layout modules, injected in that order.
 * @param fields - The text fields: told when a field enters, changes, exits and despawns, and
 *   pulled once per reconcile.
 * @returns The two frame steps and the root registry.
 */
export function createReconciler(
  ctx: UiCtx,
  modules: JsxModules,
  fields: Pick<Fields, "enter" | "patch" | "exit" | "drop" | "pull">
) {
  const state: JsxState = ctx.state.jsx;
  const ecs = ctx.deps.world.ecs;
  const lookup = (entity: Entity): Element | undefined => state.elements.get(entity);
  const range = createRange(ctx, modules.layout, {
    diffSlots: (root, scroll, slots) =>
      diffChildren(root, scroll, childrenOf(scroll.node, slots), scroll.instance),
    forgetSubtree,
    despawnTree
  });
  // The reconciler's per-frame scratch, kept so an idle frame allocates nothing: the roots to
  // reconcile, the scroll containers, the roots whose slot changed in this solve, the roots still
  // waiting in it, the viewport box, what the slots were last assigned for, and the layer list
  // the roots last took their order under.
  const dirtyList: Root[] = [];
  const scrollList: Element[] = [];
  const movedRoots: Root[] = [];
  let movedCount = 0;
  let waitingCount = 0;
  const viewportBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let slotsVersion = -1;
  let slotsRoots = -1;
  let placedUnder: ReadonlyArray<LayerSpec> | undefined;
  // The roots the reconcile of this frame diffed: a render may bring a scroll a new `offset` prop.
  let rendered = 0;

  /**
   * Registers the key of an element under its root, so `entityOf` and `find` answer for it. A key
   * `ui` gave a node of its own, a spacer's, is never registered.
   *
   * @param root - The root the element belongs to.
   * @param element - The element that entered.
   */
  function registerKey(root: Root, element: Element): void {
    if (element.key === undefined || isOwnKey(element.key)) return;

    const keys = state.byKey.get(root.entity) ?? keyMap();

    if (keys.has(element.key)) ctx.log.warn("ui:duplicate-key", { key: element.key });
    else keys.set(element.key, element.entity);

    state.byKey.set(root.entity, keys);
    element.dropKey = ctx.deps.world.projection.registerKey(root.name, element.key, element.entity);
  }

  /**
   * The resolved style of an element. A row of a windowed scroll is laid out at the row height,
   * whatever its style says.
   *
   * @param parent - The parent of the element.
   * @param node - The node of this render.
   * @param is - The state flags of the element.
   * @returns The style.
   */
  function styleFor(
    parent: Element | undefined,
    node: DescriptionNode,
    is: IsFlags
  ): ResolvedStyle {
    return range.rowStyle(parent, node, modules.styles.resolveElement(styleOf(node), is));
  }

  /**
   * Creates one element and its subtree.
   *
   * @param root - The root being reconciled.
   * @param parent - The parent element, or nothing for a root element.
   * @param node - The node to place.
   * @param identity - The identity of the element.
   * @param instance - The identity of the nearest component instance.
   * @param index - Its place among the element children of its parent.
   * @returns The new entity.
   */
  function enter(
    root: Root,
    parent: Element | undefined,
    node: DescriptionNode,
    identity: string,
    instance: string | undefined,
    index: number
  ): Entity {
    checkTag(node);

    const entity = ecs.spawn(UI_OWNER, []);
    const is = isFlagsOf(node, {
      pressed: false,
      hover: false,
      focus: false,
      covered: root.covered
    });
    const element: Element = {
      entity,
      identity,
      type: node.type,
      key: node.key,
      index,
      cause: state.building ?? "change",
      rebuilds: 0,
      parentType: parent?.type,
      root: root.entity,
      node,
      style: styleFor(parent, node, is),
      is,
      rect: { x: 0, y: 0, w: 0, h: 0 },
      previous: { x: 0, y: 0, w: 0, h: 0 },
      moved: true,
      fit: 1,
      rest: identityPose(),
      handles: [],
      loop: undefined,
      motion: node.props.motion as ElementMotion | undefined,
      parent: parent?.entity,
      children: [],
      instance,
      live: false,
      entered: false,
      dropKey: undefined,
      extras: extrasMap(),
      extraHandles: handleMap(),
      warnedOwned: nameSet(),
      warned: nameSet(),
      scrolledIn: range.isMoving()
    };

    state.styled += 1;
    state.elements.set(entity, element);
    state.byIdentity.set(identity, entity);
    trackHost(state, element);
    registerKey(root, element);

    if (element.type === "input") fields.enter(element);
    if (element.type === "scroll") {
      state.scrolls.add(entity);
      element.scroll = scrollMotionOf(node);
    }

    modules.layout.attach(element);
    // The style is on the layout node: from here an equal description keeps it.
    element.basis = { epoch: state.epoch, rowHeight: range.rowHeightOf(parent, node) };
    diffChildren(
      root,
      element,
      childrenOf(node, range.slotsFor(element), element.scroll?.axis),
      instance
    );
    root.needsSolve = true;

    return entity;
  }

  /**
   * The parent element of an element.
   *
   * @param element - The element.
   * @returns The parent, or `undefined` for a root element.
   */
  function parentOf(element: Element): Element | undefined {
    return element.parent === undefined ? undefined : lookup(element.parent);
  }

  /**
   * The rect of the parent of an element.
   *
   * @param element - The element.
   * @returns The rect, or `undefined` for a root element.
   */
  function parentRect(element: Element): Rect | undefined {
    return element.parent === undefined ? undefined : lookup(element.parent)?.rect;
  }

  /**
   * Writes the draw order of a live child again: its `zIndex` step and its place among its
   * siblings, so `renderer` sorts the siblings again. Nothing is written while the value stands;
   * a root keeps the order of its root.
   *
   * @param element - The element that changed or moved among its siblings.
   */
  function writeOrder(element: Element): void {
    if (element.parent === undefined) return;

    const current = ecs.get(element.entity, Order);
    const value = childOrder(element.style.zIndex, element.index);

    if (current === undefined) ecs.add(element.entity, Order({ value }));
    else if (current.value !== value) ecs.set(element.entity, Order, { value });
  }

  /**
   * Gives every child of a new list the place it has there: a live child whose place changed
   * writes its `Order` again; one that is not live yet takes it from `componentsOf`. A dev build
   * names a parent whose children spill over one `zIndex` step, once.
   *
   * @param parent - The element whose children were diffed.
   * @param next - Its children of this render, in markup order.
   */
  function placeChildren(parent: Element, next: readonly Entity[]): void {
    for (const [index, entity] of next.entries()) {
      const element = state.elements.get(entity);

      if (element === undefined || element.index === index) continue;

      element.index = index;
      if (element.live) writeOrder(element);
    }

    if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) return;
    if (next.length < SIBLING_SPAN || parent.warned.has("too-many-children")) return;

    parent.warned.add("too-many-children");
    ctx.log.warn("ui:too-many-children", {
      key: parent.key ?? parent.identity,
      count: next.length
    });
  }

  /**
   * Logs every value of the `components` prop whose type the element owns, once per element and
   * name. The value is dropped and the element's own component stays as the tag wrote it.
   *
   * @param element - The element being mounted or patched.
   */
  function warnOwned(element: Element): void {
    for (const value of listedOf(element.node)) {
      const component = value.type.componentName;

      if (!ELEMENT_OWNED.has(component) || element.warnedOwned.has(component)) continue;

      element.warnedOwned.add(component);
      ctx.log.error("ui:component-owned", { key: element.key ?? element.identity, component });
    }
  }

  /**
   * Diffs the extras of a live element against the ones it added last time. A new name is added
   * and its rest recorded; a name that left is removed and its motion cancelled. A name whose
   * fields changed records its new rest and plays its `change` hook with the values before and
   * after and the routed hint; when the hook returns a motion, the track brings the value home and
   * nothing is written directly. Without a hook, or when it returns nothing or throws, the fields
   * are set without the ones its type gives to a plugin. The same fields write nothing, so a tween
   * a motion hook runs on one of them survives an unrelated re-render.
   *
   * @param element - The live element that changed.
   */
  function writeExtras(element: Element): void {
    const hasNoExtras = element.extras.size === 0 && listedOf(element.node).length === 0;

    if (hasNoExtras) return;

    // Read the extras of this render and warn about the ones the element owns itself.
    const next = extrasOf(element);

    warnOwned(element);
    removeLeftExtras(element, next);
    applyChangedExtras(element, next);

    // Remember them for the next diff.
    element.extras = next;
  }

  /**
   * Removes the extras that left the `components` prop, with the motion of their last change.
   *
   * @param element - The live element that changed.
   * @param next - The extras of this render, by component name.
   */
  function removeLeftExtras(element: Element, next: ReadonlyMap<string, AnyComponentValue>): void {
    for (const [name, previous] of element.extras) {
      if (next.has(name)) continue;

      cancelExtra(element, name);
      ecs.remove(element.entity, previous.type);
    }
  }

  /**
   * Adds a new, tag or missing extra whole, and plays or patches the changed fields of the rest.
   * An extra with the same fields writes nothing.
   *
   * @param element - The live element that changed.
   * @param next - The extras of this render, by component name.
   */
  function applyChangedExtras(
    element: Element,
    next: ReadonlyMap<string, AnyComponentValue>
  ): void {
    for (const [name, value] of next) {
      const previous = element.extras.get(name);
      const isUnchanged = previous !== undefined && sameFields(previous.value, value.value);

      if (isUnchanged) continue;

      const needsAdd =
        previous === undefined ||
        previous.value === true ||
        value.value === true ||
        !ecs.has(element.entity, value.type);

      if (needsAdd) {
        ecs.add(element.entity, value);
        recordRest(ctx, element, value);

        continue;
      }

      recordRest(ctx, element, value);

      const values = { previous: previous.value, next: value.value };

      if (modules.layout.changeExtra(element, name, values, hintOf(state, element))) continue;

      const owned = ecs.typeOf(name)?.owned ?? [];

      ecs.set(element.entity, asHandle(value.type), livePatch(value.value, owned));
    }
  }

  /**
   * Writes the visual and input components of a live element again. A visual or an input the
   * element no longer carries is removed, so a variant can trade the rectangle for a nine-slice and
   * back, and a button that became disabled stops answering the gate. `Scroll`, `Scrollable` and
   * `ScrollState` are only ever added: where a scroll stands belongs to the finger and the scroll
   * step, and a new look or a new rect never resets it. The look written is recorded as the rest
   * of the visual, so the rest the world holds is always the one the element is drawn with: a
   * restore brings it back to exactly that. The extras of the `components` prop are diffed last.
   * Every call is one write pass of `UiCounters`.
   *
   * @param element - The element that changed.
   */
  function writeLive(element: Element): void {
    state.written += 1;
    writeOrder(element);

    // Remove the visuals and inputs the element no longer carries. Per restyle: the two lists are
    // read as they come, with no joined copy and no closure per type.
    const visuals = visualOf(element);
    const inputs = inputOf(element);

    for (const type of LIVE_TYPES) {
      const isDropped = !carries(visuals, type) && !carries(inputs, type);

      if (isDropped && ecs.has(element.entity, type)) ecs.remove(element.entity, type);
    }

    // Add the ones the entity lacks; patch the fields of the rest, but never a tag or a scroll's state.
    for (const value of visuals) writeValue(element, value);
    for (const value of inputs) writeValue(element, value);

    // The look just written is the rest of the visual.
    for (const value of visuals) recordRest(ctx, element, value);

    writeExtras(element);
  }

  /**
   * Writes one visual or input value onto a live element: added when the entity lacks it, else
   * its fields patched, but never a tag or the state of a scroll, and never a field its type gives
   * to a plugin.
   *
   * @param element - The live element.
   * @param value - The value of this render.
   */
  function writeValue(element: Element, value: AnyComponentValue): void {
    if (!ecs.has(element.entity, value.type)) {
      ecs.add(element.entity, value);

      return;
    }

    if (value.value === true || SCROLL_STATE.has(value.type.componentName)) return;

    const owned = ecs.typeOf(value.type.componentName)?.owned ?? NO_OWNED;

    ecs.set(element.entity, asHandle(value.type), livePatch(value.value, owned));
  }

  /**
   * Compares the node of this render with the one a live element was last patched from. The
   * resolved style is kept, and `styles.resolveElement` not called, while the raw `style` says the
   * same by value, the state flags are the same, and what a style is resolved on stands: the
   * epoch of the jsx state, which a new viewport ends, and the row height of a windowed row. The element is unchanged when its style is kept and its `content` and every
   * prop of `WRITTEN` say the same too. A plain object and an array are compared by value;
   * anything else by identity: a function, a `Set`, a `Map`, a `Date`, a class instance. The
   * same object always says the same: one changed in place is not seen.
   *
   * @param root - The root being reconciled: its covered flag is one of the state flags.
   * @param element - The element that stayed.
   * @param node - The node of this render.
   * @returns The flags and the style of this render, and what they change.
   */
  function compare(root: Root, element: Element, node: DescriptionNode): Change {
    const previous = element.node;
    const parent = parentOf(element);
    const is = isFlagsOf(node, {
      pressed: element.is.pressed,
      hover: element.is.hover,
      focus: element.is.focus,
      covered: root.covered
    });

    // What a style is resolved on besides the node itself.
    const rowHeight = range.rowHeightOf(parent, node);
    const stands = element.basis?.epoch === state.epoch && element.basis.rowHeight === rowHeight;

    // Keep the resolved style while the raw one and the flags say the same; else resolve again.
    const sameStyle = sameValue(previous.props.style, node.props.style);
    const keepsStyle = stands && sameStyle && sameValue(element.is, is);
    const style = keepsStyle ? element.style : styleFor(parent, node, is);
    const sameContent = sameValue(previous.props.content, node.props.content);

    return {
      is,
      style,
      rowHeight,
      resolved: !keepsStyle,
      moved: !keepsStyle && modules.layout.affectsRect(element.style, style),
      measures: !stands || !sameStyle || !sameContent,
      unchanged: keepsStyle && sameContent && writesSame(previous, node)
    };
  }

  /**
   * Writes what a patch changed on one element: its style onto the layout node when a rect or a
   * measure may move, which asks the root for a solve; then, on a live element, its visual, its
   * input and its extras, and its rest pose when no rect moved.
   *
   * @param root - The root being reconciled.
   * @param element - The element, its node, flags and style of this render already set.
   * @param change - What the patch found.
   */
  function rewrite(root: Root, element: Element, change: Change): void {
    const applies = change.moved || change.measures;

    // One style pass: the style was resolved again, or is written onto the layout node again.
    if (change.resolved || applies) state.styled += 1;

    if (applies) {
      modules.layout.applyStyle(element);
      root.needsSolve = true;
    }

    if (!element.live) return;

    writeLive(element);

    // A new look that moves no rect moves the rest pose now; a new rect waits for the solve.
    if (!change.moved) {
      modules.layout.repose(element, parentRect(element), false, hintOf(state, element));
    }
  }

  /**
   * Updates one live element from its new node. An element whose description says what it said is
   * neither styled nor written: no `styles.resolveElement`, no `layout.applyStyle`, no solve asked
   * for, no component set, no rest recorded, no rest pose moved. What still runs for it reads a
   * prop the comparison leaves out, or costs nothing: the check of a windowed scroll's props; the
   * node of this render kept on the element, which the hosts, the rows of a windowed scroll, a
   * text field and the measure of a text read later; its motion and its instance; the host set;
   * the props of a text field; the loop of a new motion; and the diff of its children.
   *
   * @param root - The root being reconciled.
   * @param element - The element that stayed.
   * @param node - The node of this render.
   * @param instance - The identity of the nearest component instance.
   */
  function patch(
    root: Root,
    element: Element,
    node: DescriptionNode,
    instance: string | undefined
  ): void {
    checkWindow(node);
    warnAxis(element, node);

    const change = compare(root, element, node);
    const motion = node.props.motion as ElementMotion | undefined;
    const loopChanged = !sameLoop(element.motion?.loop, motion?.loop);

    // The guard is inline and positive: a release build drops the count (spec 16 U5.2).
    if (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) {
      countRebuild(element, element.motion?.loop, motion?.loop);
    }

    // A changed element has no basis until its write went through: a patch that throws on the way
    // is done in full at the next render, not taken for one that says the same.
    if (!change.unchanged) delete element.basis;

    element.node = node;
    element.is = change.is;
    element.style = change.style;
    element.motion = motion;
    element.instance = instance;
    trackHost(state, element);

    if (element.type === "input") fields.patch(element);

    // A new loop replaces the running one, and a motion without a loop stops it. An element that
    // has not entered yet starts the loop of its motion when it enters.
    if (loopChanged && element.entered) modules.layout.loop(element);

    if (!change.unchanged) {
      rewrite(root, element, change);
      element.basis = { epoch: state.epoch, rowHeight: change.rowHeight };
    }

    diffChildren(
      root,
      element,
      childrenOf(node, range.slotsFor(element), element.scroll?.axis),
      instance
    );
  }

  /**
   * Warns once when a render gives a live scroll another `axis`: it keeps the one it spawned with.
   *
   * @param element - The element being patched.
   * @param node - The node of this render.
   */
  function warnAxis(element: Element, node: DescriptionNode): void {
    const axis = element.scroll?.axis;

    if (axis === undefined || axis === axisOf(node) || element.warned.has("scroll-axis-fixed")) {
      return;
    }

    element.warned.add("scroll-axis-fixed");
    ctx.log.warn("ui:scroll-axis-fixed", { key: element.key ?? element.identity, axis });
  }

  /**
   * Counts a patch that brings a loop of another reference that is not really another loop: the
   * same fingerprint, or a hook with none. A loop whose fingerprint changes is a loop that really
   * changes, and resets the count. At three in a row the element is named, once: its motion is
   * built in a view body and belongs at module level.
   *
   * @param element - The element being patched.
   * @param previous - The loop hook it runs.
   * @param next - The loop hook of this render.
   */
  function countRebuild(element: Element, previous: unknown, next: unknown): void {
    const rebuilt =
      previous !== undefined &&
      next !== undefined &&
      previous !== next &&
      (sameLoop(previous, next) || printOf(previous) === undefined || printOf(next) === undefined);

    element.rebuilds = rebuilt ? element.rebuilds + 1 : 0;

    if (element.rebuilds < REBUILDS_WARNED || element.warned.has("motion-rebuilt")) return;

    element.warned.add("motion-rebuilt");
    ctx.log.warn("ui:motion-rebuilt", {
      key: element.key ?? element.identity,
      fingerprinted: printOf(next) !== undefined
    });
  }

  /**
   * Expands a component node with its instance, so the view runs with the local state of that
   * identity.
   *
   * @param node - The node the markup wrote.
   * @param identity - Its identity.
   * @returns The subtree to place and the instance it belongs to.
   */
  function expand(
    node: DescriptionNode,
    identity: string
  ): { node: DescriptionNode | undefined; instance: string | undefined } {
    const definition = state.components.get(node.type);

    if (definition === undefined) return { node, instance: undefined };

    const instance = instanceFor(state, identity, definition, node.props);

    instance.dirty = false;

    const produced = runView(ctx, definition, instance, node.key);

    return { node: produced, instance: identity };
  }

  /**
   * Places one node: enter, patch, or exit and enter when the type at that key changed.
   *
   * @param root - The root being reconciled.
   * @param parent - The parent element, or nothing.
   * @param node - The node the markup wrote.
   * @param index - Its position among its siblings.
   * @param parentIdentity - The identity of the parent element.
   * @param instance - The identity of the nearest component instance.
   * @returns The entity of the element, or `undefined` when a component view threw.
   */
  function diffNode(
    root: Root,
    parent: Element | undefined,
    node: DescriptionNode,
    index: number,
    parentIdentity: string,
    instance?: string
  ): Entity | undefined {
    // Expand a component into its view; the view it produced takes the key of the component node.
    const identity = identityOf(parentIdentity, node, index);
    const expanded = expand(node, identity);
    const view = expanded.node;
    const owner = expanded.instance ?? instance;
    const isComponentView = view !== undefined && expanded.instance !== undefined;
    const effective = isComponentView ? withKey(view, node.key) : view;

    if (effective === undefined) return state.byIdentity.get(identity);

    // Patch the element at this identity when the type held; otherwise replace it.
    const existing = state.byIdentity.get(identity);
    const element = existing === undefined ? undefined : state.elements.get(existing);
    const isSameType = element !== undefined && element.type === effective.type;

    if (isSameType) {
      patch(root, element, effective, owner);

      return element.entity;
    }

    if (element !== undefined) exitElement(element, "change");

    return enter(root, parent, effective, identity, owner, index);
  }

  /**
   * Diffs the children of one element and re-places them once when the list changed.
   *
   * @param root - The root being reconciled.
   * @param parent - The element whose children are diffed.
   * @param nodes - The children of this render.
   * @param instance - The identity of the nearest component instance.
   */
  function diffChildren(
    root: Root,
    parent: Element,
    nodes: readonly DescriptionNode[],
    instance: string | undefined
  ): void {
    // Diff each child of this render; a component that threw before its first view has no entity.
    const next: Entity[] = [];

    for (const [index, node] of nodes.entries()) {
      const entity = diffNode(root, parent, node, index, parent.identity, instance);

      if (entity !== undefined) next.push(entity);
    }

    // Start the exit of every old child this render left out. A row that a range change took out
    // of a windowed scroll is not removed: it is dropped at once, with no exit motion.
    const kept = entitySet(next);
    const dropsRows = range.dropsRowsOf(parent);

    for (const old of parent.children) {
      if (kept.has(old)) continue;

      const element = state.elements.get(old);

      if (element === undefined) continue;
      if (dropsRows) range.dropRow(element);
      else exitElement(element, "change");
    }

    // Keep the new list; the same children in the same order need no new placement.
    const same =
      next.length === parent.children.length &&
      next.every((entity, index) => parent.children[index] === entity);

    parent.children = next;

    if (same) return;

    // Draw the children in the order of this render, then re-place them in the layout once, and solve again.
    placeChildren(parent, next);
    modules.layout.place(
      parent,
      next.map(entity => state.elements.get(entity)).filter(element => isElement(element))
    );
    root.needsSolve = true;
  }

  /**
   * Starts the exit of an element and of everything under it.
   *
   * @param element - The element that left the description.
   * @param cause - Why it leaves: `"change"` for a commit, `"mount"` when it goes with its screen.
   * @param leads - The element is the top of a root that goes with its screen.
   */
  function exitElement(element: Element, cause: MotionCause, leads = false): void {
    forgetSubtree(element);
    forgetInstances(state, element.identity);
    state.exiting.add(element.entity);
    exitSubtree(element, cause, false, leads);
  }

  /**
   * Plays the exit hook of an element and of everything under it, each told why it leaves. A child
   * keeps its rect and its `Exiting` tag until the whole subtree stopped moving. Under the top of a
   * root that goes with its screen and plays an exit of its own, the elements stand and go with it
   * (F55b): an exit of theirs would change the subtree in every frame of the top's, so a kept
   * picture of it would be drawn live through its filters.
   *
   * @param element - The element that leaves, or one of its children.
   * @param cause - Why the subtree leaves.
   * @param stands - The element stands under an exit that leads the leave: its own hook does not play.
   * @param leads - The element is the top of a root that goes with its screen.
   */
  function exitSubtree(
    element: Element,
    cause: MotionCause,
    stands: boolean,
    leads: boolean
  ): void {
    dropHost(state, element.entity);
    state.scrolls.delete(element.entity);

    // Its own exit, unless it stands under the one that leads.
    if (overlayOf(element) === undefined) {
      modules.layout.exit(element, cause, undefined, stands);
    } else {
      // The level of an overlay goes back with its exit motion, so the dim and the HUD are back before it goes.
      const span = createSpan();

      modules.layout.exit(element, cause, span, stands);
      exitOverlay(ctx, modules.layout, element, span);
    }

    if (element.type === "input") fields.exit(element);

    // Under a top that plays its exit with its screen, the children stand (F55b).
    const under = stands || (leads && !modules.layout.settled(element));

    for (const child of element.children) {
      const childElement = state.elements.get(child);

      if (childElement !== undefined) exitSubtree(childElement, cause, under, false);
    }
  }

  /**
   * Tells whether an exiting subtree stopped moving.
   *
   * @param element - The top of the subtree.
   * @returns True when no hook under it is still playing.
   */
  function subtreeSettled(element: Element): boolean {
    if (!modules.layout.settled(element)) return false;

    // Per exiting element and frame (two sweeps while anything leaves): an array `for…of`, no closure.
    for (const child of element.children) {
      const childElement = state.elements.get(child);

      if (childElement !== undefined && !subtreeSettled(childElement)) return false;
    }

    return true;
  }

  /**
   * Drops the identity, the key and the key registration of an element and of everything under
   * it, so `find` and `entityOf` stop answering for a subtree that is on its way out.
   *
   * @param element - The element that left the description.
   */
  function forgetSubtree(element: Element): void {
    state.byIdentity.delete(element.identity);

    const keys = state.byKey.get(element.root);

    if (element.key !== undefined && keys?.get(element.key) === element.entity) {
      keys.delete(element.key);
    }

    element.dropKey?.();
    element.dropKey = undefined;

    for (const child of element.children) {
      const childElement = state.elements.get(child);

      if (childElement !== undefined) forgetSubtree(childElement);
    }
  }

  /**
   * Despawns an exiting element and everything under it, and frees the Yoga nodes.
   *
   * @param element - The element whose motions finished.
   */
  function despawnTree(element: Element): void {
    for (const child of element.children) {
      const childElement = state.elements.get(child);

      if (childElement !== undefined) despawnTree(childElement);
    }

    modules.layout.free(element);

    // A text field being edited is done before it goes: a dropped row never passed an exit.
    if (element.type === "input") {
      fields.exit(element);
      fields.drop(element);
    }

    // A host that goes moves the hosts version, also one whose exit took it out of the host set
    // earlier: it still holds its views and a root may still be laid out in it until this despawn.
    if (hostsOf(element.node).length > 0) hostsMoved(state);

    state.hosts.delete(element.entity);
    state.scrolls.delete(element.entity);
    state.exiting.delete(element.entity);
    state.leading.delete(element.entity);
    state.overlays.delete(element.entity);
    state.elements.delete(element.entity);
    ecs.despawn(element.entity);
  }

  /**
   * Despawns every exiting element whose motions finished, and closes a popup whose root is gone.
   */
  function sweep(): void {
    // Despawn the exiting subtrees that stopped moving.
    for (const entity of state.exiting) {
      const element = state.elements.get(entity);

      if (element === undefined) {
        state.exiting.delete(entity);

        continue;
      }

      // A root that left with its screen goes with its own exit: a longer one under it is cut (F55).
      const settled = state.leading.has(entity)
        ? modules.layout.settled(element)
        : subtreeSettled(element);

      if (!settled) continue;

      despawnTree(element);
    }

    dropRemovedRoots();
  }

  /**
   * Despawns every exiting element at once, finished or not, and drops the roots that were leaving:
   * what a restore or a load does, as a page reload would (F42).
   */
  function dropLeaving(): void {
    for (const entity of state.exiting) {
      const element = state.elements.get(entity);

      if (element === undefined) state.exiting.delete(entity);
      else despawnTree(element);
    }

    dropRemovedRoots();
  }

  /**
   * Drops every removed root whose element tree is gone, and closes its popup.
   */
  function dropRemovedRoots(): void {
    for (const entity of state.removing) {
      const root = state.roots.get(entity);

      if (root === undefined) continue;

      const isStillMounted = root.element !== undefined && state.elements.has(root.element);

      if (isStillMounted) continue;

      state.removing.delete(entity);
      state.roots.delete(entity);
      state.byKey.delete(entity);
      ecs.despawn(entity);
      root.popup?.close();
    }
  }

  /**
   * Applies a solved rect to an element that is already live. A moved one gets its `Box`, its
   * visual size and its `change.Box` motion; its rest pose then plays `change.Transform` unless
   * the `change` hook already moves it. A quiet one plays neither: its root changed its place (a
   * slot came or went), so its rects changed units, not places.
   *
   * @param element - The live element to apply.
   * @param parent - The rect of its parent, or nothing for a root.
   * @param quiet - Whether the rects apply with no motion.
   */
  function applyLive(element: Element, parent: Rect | undefined, quiet: boolean): void {
    // Commit a moved rect, rewrite the components and play the `change` hook with the routed hint.
    const hint = hintOf(state, element);
    let hooked = quiet;

    if (element.moved) {
      modules.layout.commit(element, parent);
      writeLive(element);
      if (!quiet) hooked = modules.layout.change(element, element.previous, hint);
    }

    // Move the rest pose, which plays `change.Transform` only when no hook took it.
    modules.layout.repose(element, parent, hooked, hint);
  }

  /**
   * Applies the first solved rect to an element that just entered: it takes its rect and rest
   * pose with no motion, then gets every component and becomes live.
   *
   * @param element - The element that entered.
   * @param parent - The rect of its parent, or nothing for a root.
   */
  function applyFirst(element: Element, parent: Rect | undefined): void {
    // Take the rect and the rest pose without a motion.
    modules.layout.commit(element, parent);
    modules.layout.repose(element, parent, true);

    // Spawn every component the element carries, extras included.
    const root = placementOf(state.roots.get(element.root));

    element.extras = extrasOf(element);
    warnOwned(element);

    for (const value of element.extras.values()) recordRest(ctx, element, value);
    // An overlay's level and landing are the engine's: they start at 0, and its enter (at `Box`) moves them.
    if (overlayOf(element) !== undefined) ecs.add(element.entity, OverlayLevel());
    for (const value of componentsOf(element, root)) ecs.add(element.entity, value);

    element.live = true;

    // A host that comes now hosts its views in this solve, so they are first drawn under it (spec 16 U2.1).
    if (state.hosts.has(element.entity)) state.risen.add(element.entity);
  }

  /**
   * Gives every element of a solved root its components, its rest pose and its motion. A live
   * element whose rect moved gets its `Box`, its visual size and its `change.Box` motion; one
   * whose rest pose moved (a new rect, a new fit scale) plays `change.Transform` or takes it.
   *
   * @param element - The element to apply.
   * @param quiet - Whether a live element takes its rect with no motion.
   */
  function applyRects(element: Element, quiet = false): void {
    // Apply this element: a live one moves, a new one spawns its components.
    const parent = parentRect(element);

    if (element.live) {
      applyLive(element, parent, quiet);
    } else {
      applyFirst(element, parent);
    }

    element.moved = false;

    // Then its children, top-down.
    for (const child of element.children) {
      const childElement = lookup(child);

      if (childElement !== undefined) applyRects(childElement, quiet);
    }
  }

  /**
   * Where the element of a root draws: its layer and order, and its slot with the place the slot
   * lists the root's projection at.
   *
   * @param root - The root, or nothing for an element whose root is gone.
   * @returns The placement `componentsOf` takes.
   */
  function placementOf(root: Root | undefined): RootPlacement {
    if (root === undefined) return { layer: "ui", order: 0 };
    if (root.slot === undefined) return { layer: root.layer, order: root.order };

    return {
      layer: root.layer,
      order: root.order,
      slot: { host: root.slot, order: slotOrderOf(root) }
    };
  }

  /**
   * The place a slot lists the projection of a root at: the root's `Order` among the slot's
   * children, an integer, so it draws over the slot's element children at `zIndex` 0.
   *
   * @param root - A root laid out in a slot.
   * @returns The index of its projection in the slot's `hosts`, 0 when the slot no longer names it.
   */
  function slotOrderOf(root: Root): number {
    const host = root.slot === undefined ? undefined : state.elements.get(root.slot);
    const index = host === undefined ? -1 : hostsOf(host.node).indexOf(root.name);

    return Math.max(0, index);
  }

  /**
   * Hangs the live element of a root where its root is placed now: under its new slot, with the
   * slot's order, or back in its layer at the root's order. The renderer puts a view whose
   * `Parent` left back in its layer. An element that is not live yet takes its place from
   * `componentsOf`.
   *
   * @param root - A root whose slot changed.
   */
  function placeRoot(root: Root): void {
    const element = root.element === undefined ? undefined : lookup(root.element);

    if (element?.live !== true) return;

    if (root.slot === undefined) {
      ecs.remove(element.entity, Parent);
      ecs.set(element.entity, Order, { value: root.order });

      return;
    }

    ecs.add(element.entity, Parent({ entity: root.slot }));
    ecs.set(element.entity, Order, { value: slotOrderOf(root) });
  }

  /**
   * Names, in a dev build, every other host that names a root's projection besides its slot, once
   * per host and projection: the first host takes it, the others draw nothing for it.
   *
   * @param root - The root.
   * @param slot - The slot it took.
   */
  function warnTaken(root: Root, slot: Entity): void {
    for (const host of state.hosts) {
      const element = host === slot ? undefined : slotFor(state, root, host);
      const once = `slot-taken:${root.name}`;

      if (element === undefined || element.warned.has(once)) continue;

      element.warned.add(once);
      ctx.log.warn("ui:slot-taken", {
        projection: root.name,
        host: element.key ?? element.identity
      });
    }
  }

  /**
   * Tells whether a root was found slotted in a root slotted in it: it stays on the viewport.
   *
   * @param root - The root.
   * @returns True after a cycle of slots was logged for its element.
   */
  function isCyclic(root: Root): boolean {
    const element = root.element === undefined ? undefined : lookup(root.element);

    return element?.warned.has("slot-cycle") === true;
  }

  /**
   * Gives every root its slot for this solve (spec 16 U3.3). A root whose slot changed needs a
   * solve, and takes its new rects with no motion; a live root element hangs at its new place now.
   * The slots stand while no host moved and no root came or went: the hosts version and the root
   * count are those of the last assignment.
   */
  function assignSlots(): void {
    movedCount = 0;

    // Per frame: two numbers decide; an idle frame walks no root.
    if (state.hostsVersion === slotsVersion && state.roots.size === slotsRoots) return;

    slotsVersion = state.hostsVersion;
    slotsRoots = state.roots.size;

    for (const root of state.roots.values()) {
      if (state.removing.has(root.entity)) continue;

      const slot = isCyclic(root) ? undefined : slotOf(state, root);
      const dev = typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__;

      if (dev && slot !== undefined) warnTaken(root, slot);
      if (slot === root.slot) continue;

      root.slot = slot;
      root.slotRect = undefined;
      root.needsSolve = true;
      movedRoots[movedCount] = root;
      movedCount += 1;
      placeRoot(root);
    }
  }

  /**
   * Tells whether the slot of a root changed in this solve.
   *
   * @param root - The root.
   * @returns True when it takes its rects with no motion.
   */
  function isMoved(root: Root): boolean {
    for (let index = 0; index < movedCount; index += 1) {
      if (movedRoots[index] === root) return true;
    }

    return false;
  }

  /**
   * Marks the roots this solve may lay out `pending`: every root marked for a solve, and every root
   * in a slot, whose slot may have been resized.
   *
   * @returns How many roots wait.
   */
  function pendingRoots(): number {
    let count = 0;

    // Per solve: a flag on the root, not a new set.
    for (const root of state.roots.values()) {
      const waits =
        root.element !== undefined &&
        lookup(root.element) !== undefined &&
        (root.needsSolve || root.slot !== undefined);

      root.pending = waits;
      if (waits) count += 1;
    }

    return count;
  }

  /**
   * The box a root in a slot is solved in: the slot's content box, once the slot's own root needs
   * no solve in this call any more. The box is the layout's scratch: valid until the next call.
   *
   * @param root - A root laid out in a slot.
   * @returns The box, or `undefined` while the slot's root waits.
   */
  function slotBoxOf(root: Root): Rect | undefined {
    const host = root.slot === undefined ? undefined : state.elements.get(root.slot);

    if (host === undefined) return undefined;

    const hostRoot = state.roots.get(host.root);

    return hostRoot?.pending === true ? undefined : modules.layout.contentRect(host);
  }

  /**
   * Solves one root in a box and applies its rects: a root on the viewport when it is marked, a
   * root in a slot also when its slot was resized.
   *
   * @param root - The root.
   * @param box - The viewport, or the slot's content box.
   * @param quiet - Whether its live elements take their rects with no motion.
   * @returns True when the root was solved.
   */
  function solveOne(root: Root, box: Rect, quiet: boolean): boolean {
    const element = root.element === undefined ? undefined : lookup(root.element);

    if (element === undefined) return false;

    const resized = root.slot !== undefined && !sameBox(root.slotRect, box);

    if (!root.needsSolve && !resized) return false;
    // Kept: a copy, the box may be scratch.
    if (root.slot !== undefined) root.slotRect = { x: box.x, y: box.y, w: box.w, h: box.h };

    modules.layout.solve(element, box, lookup);
    root.needsSolve = false;
    applyRects(element, quiet);

    return true;
  }

  /**
   * Solves every root that needs it, in passes: a root in a slot waits for the root of its slot,
   * and a slot inside a slot takes one more pass. The roots still waiting after the last pass are
   * slotted in each other: each is laid out on the viewport instead. A root whose slot changed in
   * this solve takes its rects with no motion.
   *
   * @param size - The viewport.
   * @returns True when a root was solved.
   */
  function layOutRoots(size: Rect): boolean {
    let changed = false;

    waitingCount = pendingRoots();

    for (let pass = 0; pass < SLOT_PASSES && waitingCount > 0; pass += 1) {
      if (solvePass(size)) changed = true;
    }

    if (waitingCount === 0) return changed;

    for (const root of state.roots.values()) {
      if (root.pending !== true) continue;

      root.pending = false;
      breakCycle(root);
      if (solveOne(root, size, true)) changed = true;
    }

    waitingCount = 0;

    return changed;
  }

  /**
   * One pass over the waiting roots, in mount order: every root whose box is known now is solved
   * and stops waiting.
   *
   * @param size - The viewport.
   * @returns True when a root was solved.
   */
  function solvePass(size: Rect): boolean {
    let changed = false;

    for (const root of state.roots.values()) {
      if (root.pending !== true) continue;

      const box = root.slot === undefined ? size : slotBoxOf(root);

      if (box === undefined) continue;

      root.pending = false;
      waitingCount -= 1;
      if (solveOne(root, box, isMoved(root))) changed = true;
    }

    return changed;
  }

  /**
   * Lays out a root of a cycle of slots on the viewport instead, clears its slot and logs the
   * cycle once: it stays out of slots from then on.
   *
   * @param root - A root still waiting after the last pass.
   */
  function breakCycle(root: Root): void {
    const element = root.element === undefined ? undefined : lookup(root.element);

    root.slot = undefined;
    root.slotRect = undefined;
    root.needsSolve = true;
    placeRoot(root);

    if (element === undefined || element.warned.has("slot-cycle")) return;

    element.warned.add("slot-cycle");
    ctx.log.error("ui:slot-cycle", { projection: root.name });
  }

  /**
   * Keeps an element whose spawn has just been applied: the world calls it from the `Box` hook, at
   * the flush of phase `layout`. Its enter hook waits for `playEntered`, so the game's systems see
   * the entity first (F48). The hook itself plays at once, so they see the start pose it writes (F49);
   * `ui.enter` plays it again when one of them changed what it read.
   *
   * @param entity - The entity the `Box` was attached to.
   */
  function queueEnter(entity: Entity): void {
    const entering = state.entering;

    // A slot past the end grows the array once; later frames write into the slots it kept.
    if (entering.count < entering.list.length) entering.list[entering.count] = entity;
    else entering.list.push(entity);

    entering.count += 1;

    const element = state.elements.get(entity);

    // Its hook plays now, so the game's systems see the element as it will be drawn (F49).
    if (arrives(element)) {
      modules.layout.pose(element, overlayOf(element) === undefined ? undefined : createSpan());
    }
  }

  /**
   * Plays the enter hooks queued since the last call, in the order the elements came. The `ui.enter`
   * system calls it in phase `sync`: after the game's systems, which may have written what a hook
   * reads (a list's scroll), and before `renderer.sync`, so an element is never drawn at its rest
   * pose by mistake. An element despawned in between plays nothing.
   */
  function playEntered(): void {
    const entering = state.entering;

    // Per frame: an index loop over the kept slots, the count read every turn, as a hook may queue another element.
    for (let index = 0; index < entering.count; index += 1) {
      const entity = entering.list[index];

      if (entity !== undefined) playEnter(entity);
    }

    entering.count = 0;
  }

  /**
   * Plays the enter hook of an element whose spawn has been applied, once. A row a range change
   * scrolled in is not new: it plays no `enter` hook, only its loop starts.
   *
   * @param entity - The entity the `Box` was attached to.
   */
  function playEnter(entity: Entity): void {
    const element = state.elements.get(entity);

    if (element === undefined || element.entered) return;

    element.entered = true;

    if (element.scrolledIn) {
      modules.layout.loop(element);
    } else if (overlayOf(element) === undefined) {
      modules.layout.enter(element);
    } else {
      // The level of an overlay follows its enter motion: the hook's tracks are measured as it plays.
      const span = createSpan();

      modules.layout.enter(element, span);
      enterOverlay(ctx, state, modules.layout, { element, span });
    }
  }

  /**
   * Asks for every root to be built again. The world calls it after a restore or a load, when it
   * brought every element to its rest pose and ended every track on it. The next reconcile does
   * the work, because only then the tree of the restored state is here to build from.
   */
  function converged(): void {
    state.remount = true;
    ctx.deps.time.wake();
  }

  /**
   * Builds every root again from nothing: its element tree is dropped at once, with no exit, and
   * the reconcile of this pass enters it through the mount path. So after a restore or a load an
   * element stands exactly as if its root had just been mounted with the restored state: a new
   * entity with the components of the description, then its `enter` hook, then its loop. What a
   * mount does not bring is gone with the old tree: the local state of a component, a scroll
   * offset, the keyboard focus, a text being edited, a hover. An element or a root that is
   * leaving is dropped at once, as a page reload drops it.
   */
  function remountRoots(): void {
    state.remount = false;
    dropLeaving();

    for (const root of state.roots.values()) {
      if (state.removing.has(root.entity)) continue;

      const element = root.element === undefined ? undefined : lookup(root.element);

      if (element !== undefined) {
        forgetSubtree(element);
        forgetInstances(state, element.identity);
        despawnTree(element);
      }

      root.element = undefined;
      root.dirty = true;
      root.needsSolve = true;
      // A restore or a load is a mount: the rebuilt elements stand at rest under `when: "change"`.
      root.cause = "mount";
    }
  }

  /**
   * Reconciles one root from the node its `Tree` carries. Its first build reads how the root came,
   * from the world's view record, which exists by now; the elements entered by this diff take that
   * cause, and the elements of any later diff take `"change"` (spec 16 U4).
   *
   * @param root - The root to reconcile.
   */
  function reconcileRoot(root: Root): void {
    const identity = String(root.entity);
    const first = root.element === undefined;

    if (first) root.cause ??= ctx.deps.world.projection.causeOf(root.entity) ?? "change";

    state.building = first ? root.cause : "change";

    try {
      root.element = diffNode(root, undefined, root.tree, 0, identity);
    } finally {
      state.building = undefined;
    }
  }

  /**
   * The live scroll containers, which the frame step moves with the finger. Read from the set the
   * enter fills and the exit empties, so an idle frame walks no other element.
   *
   * @returns Every live element whose tag is `scroll`: the reconciler's own list, valid until the
   *   next call.
   */
  function scrollContainers(): readonly Element[] {
    // Per frame: one kept list, emptied by `pop` (a cut by `length` would free its store).
    while (scrollList.length > 0) scrollList.pop();

    for (const entity of state.scrolls) {
      const element = state.elements.get(entity);

      if (element?.live === true) scrollList.push(element);
    }

    return scrollList;
  }

  /**
   * Collects the roots that have work this frame into the dirty list: a changed tree, a dirty
   * instance or style, and every root when the viewport changed.
   *
   * @param viewportChanged - Whether the viewport moved since the last frame.
   * @returns How many roots the list holds, in mount order.
   */
  function dirtyRoots(viewportChanged: boolean): number {
    // A changed tree marks its root: the walk below then reads one flag per root.
    for (const entity of ecs.changed(WORLD_TREE)) {
      const root = state.roots.get(entity);

      if (root !== undefined && !state.removing.has(entity)) root.dirty = true;
    }

    let count = 0;

    for (const root of state.roots.values()) {
      if (state.removing.has(root.entity)) continue;

      if (viewportChanged) root.needsSolve = true;
      else if (!root.dirty) continue;

      // Per frame: written by index into the kept list, its count beside it.
      dirtyList[count] = root;
      count += 1;
    }

    return count;
  }

  /**
   * Takes the order the projection wrote on a root's entity (spec 16 U1.6) and gives it to the
   * live root element when it changed, so the roots of a layer keep the order of the scene's list.
   *
   * @param root - A root with work this frame.
   */
  function refreshRootOrder(root: Root): void {
    const order = ecs.get(root.entity, Order)?.value;

    if (order === undefined || order === root.order) return;

    root.order = order;

    const element = root.element === undefined ? undefined : lookup(root.element);

    // A root in a slot draws at the place its slot lists it.
    if (element?.live === true && root.slot === undefined) {
      ecs.set(element.entity, Order, { value: order });
    }
  }

  /**
   * Gives every root the order its entity holds once a new scene stands: a scene that keeps a
   * projection both scenes list places it again (F23), and its tree stands, so no root is dirty.
   * The world places it only under a new layer list, so the walk runs once per new list, in the
   * first layout phase that runs after it, also when the switch came while the world was paused.
   */
  function reorderRoots(): void {
    const layers = ctx.deps.world.projection.layers();

    // Per frame: one identity compare while the scene stands.
    if (layers === placedUnder) return;

    placedUnder = layers;

    for (const root of state.roots.values()) {
      if (!state.removing.has(root.entity)) refreshRootOrder(root);
    }
  }

  /**
   * Reconciles one dirty root: reads its current tree and projection name, then diffs it. The root
   * stays dirty while the layout engine is not loaded, and a failure is logged for this root only.
   *
   * @param root - A root with work this frame.
   */
  function reconcileDirtyRoot(root: Root): void {
    // Take the tree and the name the projection holds now.
    const tree = ecs.get(root.entity, WORLD_TREE);
    const place = ctx.deps.world.projection.keyOf(root.entity);

    if (place !== undefined) root.name = place.projection;
    if (tree !== undefined) root.tree = tree.node as DescriptionNode;

    refreshRootOrder(root);

    // Without the layout engine the root stays dirty and waits for a later frame.
    root.dirty = !modules.layout.loaded();

    if (root.dirty) return;

    // A failing root is logged and the other roots still reconcile.
    try {
      reconcileRoot(root);
    } catch (error) {
      ctx.log.error("ui:root-failed", { root: root.name }, asError(error));
    }
  }

  /**
   * The first of the two systems of phase `layout`: the sweep, the roots a restore asked to build
   * again, the roots a scene placed again, the popups that may leave, the pull of the text being
   * typed, the scroll offsets and the windowed ranges, the bound texts that show a string of
   * another size, the viewport, the dirty roots and the hosted views.
   *
   * @param time - The frame's `Time`: the scrolls move by its `delta`.
   */
  function reconcile(time: Readonly<Time> = NO_TIME): void {
    // Despawn what finished exiting, and count this pass.
    sweep();
    state.reconciles += 1;

    // After a restore or a load every root is built again, the way a mount builds it.
    if (state.remount) remountRoots();

    // A root a new scene kept draws at its place in that scene's list.
    reorderRoots();

    // A released popup leaves once the flow rests on a node that shows none of its component.
    settlePopups(ctx, state, unmountRoot);

    // The text being typed reaches the local of its component before the roots re-render.
    fields.pull();

    // Move the scroll containers with the finger, a fling or a glide, then cut the windowed ranges
    // at that offset, before any root is diffed.
    const containers = scrollContainers();

    modules.layout.scroll(containers, lookup, time);
    range.step(containers);

    // A text that `text` wrote this frame and that measures to another size now asks its root
    // for a solve: a bound number, a new locale, a font that arrived.
    markResizedTexts(ctx, state, modules.layout);

    // An icon without a size carries no `Text`: it is measured again when the line it is squared
    // on moved, which is when the body font arrives.
    markResizedIcons(ctx, state, modules.layout);

    // Reconcile every root whose tree, instance or style changed, and all of them on a new viewport.
    const viewportChanged = modules.styles.useViewport(ctx.deps.renderer.viewport.size());

    // On a new viewport a style resolves to something else: a new epoch patches every element in
    // full, however equal its description is.
    if (viewportChanged) state.epoch += 1;

    const count = dirtyRoots(viewportChanged);

    rendered = count;

    for (let index = 0; index < count; index += 1) {
      const root = dirtyList[index];

      if (root !== undefined) reconcileDirtyRoot(root);
    }

    // Give the views a slot hosts their parent, take it back where the slot left, and publish the
    // frame's counters.
    hostViews(ctx, state);
    writeCounters();
  }

  /**
   * Copies the counters of the two modules into the resource the acceptance tests read. The three
   * of the layout are read from its state: `layout.counters()` would build an object per call.
   */
  function writeCounters(): void {
    const counters = ecs.resource(UiCounters);
    const layout = ctx.state.layout;

    counters.nodes = layout.nodes;
    counters.measured = layout.measured;
    counters.solves = layout.solves;
    counters.reconciles = state.reconciles;
    counters.windowRenders = state.windowRenders;
    counters.styled = state.styled;
    counters.written = state.written;
  }

  /**
   * The second system of phase `layout`: every root takes its slot, then one solve per marked
   * root, a root in a slot after the root of its slot and in its content box, then the rects, the
   * rest poses and the hooks, the scrolls settled on what the solve and the render gave them, the
   * hosting of the hosts that came, and a sweep of what left with nothing to wait for. The hints released since the last frame step are dropped
   * at its end, so the `change.Box` and `change.Transform` hooks the solve plays get the hint the
   * reconcile routed, and the next frame starts with none.
   *
   * @param time - The frame's `Time`: a scroll left moving asks for a frame only while it runs.
   */
  function solve(time: Readonly<Time> = NO_TIME): void {
    const viewport = modules.styles.viewport();

    // Per frame: the viewport box is the reconciler's scratch; the solve keeps no reference to it.
    viewportBox.w = viewport?.width ?? 0;
    viewportBox.h = viewport?.height ?? 0;
    assignSlots();

    const changed = layOutRoots(viewportBox);

    if (changed) ctx.deps.time.wake();

    // A solve may give a scroll a new range and a render a new `offset` prop; a scroll that came in
    // this solve stands at its prop before it is first drawn.
    if (changed || rendered > 0) modules.layout.settleScroll(scrollContainers(), lookup, time);

    rendered = 0;

    // Land the overlays whose enter is over: the renderer reads it in this frame.
    settleOverlays(ctx, state, modules.layout);

    // The hosts that came in this solve take their views now: the parents land at the flush of phase
    // `layout`, before the first `sync` pass that draws the hosts (spec 16 U2.1, K4).
    if (state.risen.size > 0) {
      hostViews(ctx, state, state.risen);
      state.risen.clear();
    }

    // An element that left in this frame's reconcile with nothing to wait for (no exit hook, a hook that played
    // nothing) goes before this frame is drawn, not at the next reconcile (F46). Per frame: two size reads.
    if (state.exiting.size > 0 || state.removing.size > 0) sweep();

    state.hints.length = 0;
    writeCounters();
  }

  /**
   * Records a root: a projection view that returned a tree, or a popup this plugin spawned. The
   * `Tree` hook and the popup handler both call it, in either order, so a second call fills in
   * what the first one could not know.
   *
   * @param entity - The entity that carries `Tree`.
   * @param name - The projection name, or the component name of a popup.
   * @param layer - The layer it draws in.
   * @param popup - The popup side of the handler that shows it: what to call when the root is
   *   gone, whether its effect ended, and the root it was opened over.
   */
  function mountRoot(entity: Entity, name: string, layer: string, popup?: PopupLink): void {
    const known = state.roots.get(entity);

    if (known !== undefined) {
      known.order = ecs.get(entity, Order)?.value ?? known.order;

      if (popup !== undefined) {
        known.popup = popup;
        known.name = name;
        // A popup's open is an event: its elements play their motion whatever `when` says.
        known.cause = "change";
      }

      return;
    }

    const tree = ecs.get(entity, WORLD_TREE);

    // A new root takes its slot at the next solve.
    hostsMoved(state);
    state.roots.set(entity, {
      entity,
      name,
      order: ecs.get(entity, Order)?.value ?? 0,
      tree: (tree?.node ?? { type: "screen", props: {}, children: [] }) as DescriptionNode,
      layer,
      dirty: true,
      needsSolve: true,
      element: undefined,
      popup,
      covered: false,
      cause: popup === undefined ? undefined : "change",
      slot: undefined,
      slotRect: undefined,
      pending: false
    });
  }

  /**
   * Starts the teardown of a root: every element exits with its motion, then the sweep frees the
   * nodes and despawns the root entity. A popup leaves by an event; a projection root leaves the
   * way its view did, which the world still answers in its removal hook: `"mount"` with its scene,
   * a load or a restore. A root that goes with its screen ends with the exit of its top element
   * when that plays one, so a longer exit under it does not hold it and its bundles (F55).
   *
   * @param entity - The root entity.
   */
  function unmountRoot(entity: Entity): void {
    const root = state.roots.get(entity);

    if (root === undefined || state.removing.has(entity)) return;

    const element = root.element === undefined ? undefined : lookup(root.element);
    const cause =
      root.popup === undefined ? (ctx.deps.world.projection.causeOf(entity) ?? "change") : "change";

    state.removing.add(entity);
    // A root that leaves gives its slot up at the next solve.
    hostsMoved(state);

    if (element !== undefined) {
      exitElement(element, cause, cause === "mount");
      // Its own exit is the leave of a root that goes with its screen; with none, its children's are (F55).
      const leadsItsLeave = cause === "mount" && !modules.layout.settled(element);

      if (leadsItsLeave) state.leading.add(element.entity);
    }

    ctx.deps.time.wake();
  }

  /**
   * Re-resolves the style of one element whose pointer or focus flag changed: a press, a release,
   * the mouse coming over it or leaving it, the keyboard focus arriving or leaving. A new rect
   * waits for the solve; a new look and a new rest pose apply now. Only this element is restyled:
   * its root is not reconciled again, because no view reads a pointer or focus flag, and the next
   * render that does come finds the flags and the style already in step.
   *
   * @param entity - The element entity.
   * @param flag - Which flag changed.
   * @param on - Its value now.
   */
  function markPointer(entity: Entity, flag: PointerFlag, on: boolean): void {
    const element = state.elements.get(entity);

    if (element === undefined) return;

    // Per press: the flag flips in place; the flags object is the element's own.
    element.is[flag] = on;

    const style = styleFor(parentOf(element), element.node, element.is);
    const root = state.roots.get(element.root);
    const moved = modules.layout.affectsRect(element.style, style);

    element.style = style;
    state.styled += 1;

    if (moved) {
      modules.layout.applyStyle(element);

      if (root !== undefined) root.needsSolve = true;
    }

    if (!element.live) return;

    writeLive(element);

    if (!moved) modules.layout.repose(element, parentRect(element), false);
  }

  return {
    reconcile,
    solve,
    mountRoot,
    unmountRoot,
    markPointer,
    queueEnter,
    playEntered,
    sweep,
    converged
  };
}
