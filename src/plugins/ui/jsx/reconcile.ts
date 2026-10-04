/**
 * @file ui/jsx — the reconcile: a description tree diffed by identity into the entities `ui`
 * owns, and the solve that gives every one of them its rect before it is ever drawn.
 */
import type { Hint } from "../../flow/types";
import { PointerOver, Pressed, Tappable, Touchable } from "../../input/components";
import type { Json } from "../../model/types";
import {
  NineSlice,
  Parent,
  Shape,
  Sprite,
  Transform,
  type TransformValue
} from "../../renderer/components";
import { Text } from "../../text/components";
import { Exiting, Layer, Order, Tree as WORLD_TREE } from "../../world/ecs/define";
import type {
  AnyComponentType,
  AnyComponentValue,
  ComponentType,
  Entity,
  MotionHandle
} from "../../world/types";
import { Box, Escapable, LocalWrite, Scroll, UI_OWNER, UiCounters } from "../components";
import { asError, asHandle } from "../errors";
import type { LayoutModule, Rect, RowRange } from "../layout/types";
import type { IsFlags, ResolvedStyle, Style, StylesModule } from "../styles/types";
import type { UiCtx } from "../types";
import { CONTENT, visualOf } from "../visual";
import type { Fields } from "./fields";
import { hintFor } from "./hints";
import { hostViews, trackHost } from "./hosts";
import { forgetInstances, instanceFor, runView } from "./instances";
import { settlePopups } from "./popups";
import type {
  DescriptionNode,
  Element,
  ElementMotion,
  JsxChild,
  JsxState,
  PointerFlag,
  PopupLink,
  Root,
  ScrollWindow
} from "./types";
import {
  BOTTOM_SPACER,
  emptySlot,
  isOwnKey,
  rowStyleOf,
  slotOf,
  spacerNode,
  TOP_SPACER,
  windowFormOf
} from "./window";

/** What the modules injected into `jsx` are. */
export type JsxModules = { styles: StylesModule; layout: LayoutModule };

/** The four components an element may be drawn with; a state change can trade one for another. */
const VISUALS: readonly AnyComponentType[] = [Sprite, NineSlice, Shape, Text];

/**
 * The input components of an element and the Escape marker; a disabled or covered button drops
 * the answering one and the marker.
 */
const INPUTS: readonly AnyComponentType[] = [Tappable, Touchable, LocalWrite, Scroll, Escapable];

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

/**
 * The state flags that do not come from the markup: the pointer's two, the keyboard's one and
 * the root's one.
 */
type LiveFlags = Pick<IsFlags, "pressed" | "hover" | "focus" | "covered">;

/**
 * The children one element is diffed against. A scroll container holds exactly one of them: the
 * content the finger moves, which keeps the rects of its own children and carries them along. Its
 * pivot is its top-left corner, so the scroll step writes its offset straight into `y`; it lays
 * its children out as a column. The content of a windowed scroll holds the slots of its window,
 * the two spacers and the rows, instead of the markup's children.
 *
 * @param node - The node the markup wrote.
 * @param slots - The slots of a windowed scroll, top spacer to bottom spacer.
 * @returns The children of the element.
 * @example
 * ```ts
 * childrenOf({ type: "scroll", props: {}, children: [] }).length; // 1
 * ```
 */
export function childrenOf(
  node: DescriptionNode,
  slots?: DescriptionNode[]
): readonly DescriptionNode[] {
  if (node.type !== "scroll") return node.children;

  return [{ type: CONTENT, props: { style: CONTENT_STYLE }, children: slots ?? node.children }];
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
 * isFlagsOf(
 *   { type: "button", props: { state: { active: true } }, children: [] },
 *   { pressed: false, hover: true, focus: false, covered: false }
 * ).hover; // true
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
 * Refuses the props of a scroll its windowed form cannot take: some but not all of `rows`,
 * `rowHeight` and `row`, or a row height that is not above 0. Called before anything is spawned or
 * patched, so a refused scroll leaves no half-made element.
 *
 * @param node - The node being placed.
 * @throws {Error} For a windowed scroll whose props do not hold.
 */
function checkWindow(node: DescriptionNode): void {
  if (node.type === "scroll") windowFormOf(node);
}

/**
 * Refuses the tags that cannot be placed: a text field that names no local field, a horizontal
 * scroll, and a windowed scroll whose props do not hold.
 *
 * @param node - The node being placed.
 * @throws {Error} For an `input` tag without `local`, for a horizontal scroll and for a windowed
 *   scroll whose props do not hold.
 */
function checkTag(node: DescriptionNode): void {
  if (node.type === "input" && typeof node.props.local !== "string") {
    throw new Error('[game] An input needs a local field.\n  Write <input local="name" />.');
  }

  if (node.type === "scroll" && node.props.axis === "x") {
    throw new Error('[game] Horizontal scroll arrives after V3.\n  Use axis "y".');
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
 * the tap that starts its editing; a scroll container takes the press that moves its content. A button of a covered popup answers nothing,
 * so only the top popup answers the gate. A button with the `escape` prop that answers also
 * carries `Escapable`, the control the Escape key taps.
 *
 * @param element - The element to make touchable.
 * @returns The component values.
 */
function inputOf(element: Element): AnyComponentValue[] {
  const { type, node, is } = element;

  if (type === "scroll") return [Touchable(), Scroll({ axis: "y" })];
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
 * const node = { type: "row", props: { components: [Transform({ x: 10 }), Held()] }, children: [] };
 * [...extrasOf({ node }).keys()]; // ["Held"]
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
 * Everything an entering element gets at once, so a display object never exists without a rect.
 * A child draws with its parent, at the `zIndex` of its style among its siblings when it sets
 * one; the root element draws in the layer of its root, at its order, and ignores `zIndex`. The
 * extras of its `components` prop come after its own visual and input, before `Box`.
 *
 * @param element - The element whose rect, rest pose and extras are known.
 * @param root - The layer and the order of the root the element belongs to.
 * @param root.layer - The layer the root draws in.
 * @param root.order - The order of the root inside that layer.
 * @returns The component values the entity is filled with.
 */
export function componentsOf(
  element: Element,
  root: { layer: string; order: number }
): AnyComponentValue[] {
  const values: AnyComponentValue[] = [Transform(element.rest)];

  if (element.parent === undefined) {
    values.push(Layer({ name: root.layer }), Order({ value: root.order }));
  } else {
    values.push(Parent({ entity: element.parent }));

    if (element.style.zIndex !== undefined) values.push(Order({ value: element.style.zIndex }));
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
 * The patch a live element writes into one of its components: every field but the ones the
 * component type gives to a plugin. That plugin keeps such a field for the life of the entity, so
 * a re-render never puts it back to its default: a label keeps the string `text` resolved for it.
 *
 * @param value - The component value the element carries now.
 * @param owned - The fields the component type gives to a plugin.
 * @returns The fields to write.
 * @example
 * ```ts
 * livePatch({ content: "Play", resolved: "" }, ["resolved"]); // { content: "Play" }
 * ```
 */
function livePatch(value: object, owned: readonly string[]): object {
  if (owned.length === 0) return value;

  return Object.fromEntries(Object.entries(value).filter(([field]) => !owned.includes(field)));
}

/**
 * The rest pose recorded for an extra component: the value of this render, but the fields the
 * component type gives to a plugin stay as the entity carries them, so a render never resets them.
 *
 * @param current - The value the entity carries now; none before the component is added.
 * @param value - The value of this render.
 * @param owned - The fields the component type gives to a plugin.
 * @returns The rest value.
 * @example
 * ```ts
 * restValueOf({ until: 2000, left: 42 }, { until: 5000, left: 0 }, ["left"]); // { until: 5000, left: 42 }
 * ```
 */
function restValueOf(current: object | undefined, value: object, owned: readonly string[]): object {
  if (current === undefined || owned.length === 0) return value;

  return { ...current, ...livePatch(value, owned) };
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

  // The windowed scroll whose range is moving right now: while it is set, a row that leaves its
  // content is dropped at once and an element that enters plays no `enter` hook.
  let windowing: Entity | undefined;

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
   * Logs one warning or error of an element once for its whole life, by event name.
   *
   * @param element - The element the log is about.
   * @param event - The event name, also what makes it once.
   * @param data - The payload.
   * @param level - `warn`, or `error` for a broken row.
   */
  function logOnce(
    element: Element,
    event: string,
    data: Record<string, unknown>,
    level: "warn" | "error" = "warn"
  ): void {
    if (element.warned.has(event)) return;

    element.warned.add(event);

    if (level === "error") ctx.log.error(event, data);
    else ctx.log.warn(event, data);
  }

  /**
   * The windowed scroll whose rows the children of an element are: set when the element is the
   * content of a windowed scroll.
   *
   * @param parent - The parent of the element being placed.
   * @returns The scroll, or `undefined`.
   */
  function windowedScrollOf(parent: Element | undefined): Element | undefined {
    if (parent?.type !== CONTENT || parent.parent === undefined) return undefined;

    const scroll = lookup(parent.parent);

    return scroll?.window === undefined ? undefined : scroll;
  }

  /**
   * The resolved style of an element. A row of a windowed scroll is laid out at the row height,
   * whatever its style says; a row style with another height is one warning per scroll.
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
    const style = modules.styles.resolveElement(styleOf(node), is);
    const scroll = windowedScrollOf(parent);

    if (scroll?.window === undefined || isOwnKey(node.key)) return style;

    const { rowHeight } = scroll.window;

    if (style.height !== undefined && style.height !== rowHeight) {
      logOnce(scroll, "ui:row-height-overridden", { key: scroll.key ?? scroll.identity });
    }

    return rowStyleOf(style, rowHeight);
  }

  /**
   * The hint routed to an element in this frame step: the first hint released since the last one
   * whose payload names its key, within its root.
   *
   * @param element - The element whose hooks are about to run.
   * @returns The hint, or `undefined`.
   */
  function hintOf(element: Element): Hint | undefined {
    if (state.hints.length === 0) return undefined;

    const root = state.roots.get(element.root);

    return root === undefined ? undefined : hintFor(state.hints, root.name, element.key);
  }

  /**
   * Records the rest pose of one extra component with a value, so a `change` hook can bring it
   * home with `view.toRest`; a tag has no rest. The fields the type gives to a plugin are skipped.
   *
   * @param element - The element that carries the extra.
   * @param value - The value of this render.
   */
  function recordRest(element: Element, value: AnyComponentValue): void {
    if (value.value === true) return;

    // A value that is not `true` belongs to a component type, never to a tag.
    const type = value.type as ComponentType<object>;
    const rest = restValueOf(ecs.get(element.entity, type), value.value, type.owned);

    ctx.deps.world.projection.setRest(element.entity, type, rest);
  }

  /**
   * The height a windowed scroll cuts its first range with, before it has a rect: its style's
   * height when that is a number, else the viewport's. The range step corrects it after the solve.
   *
   * @param element - The scroll that is entering.
   * @returns The height in reference units.
   */
  function mountHeightOf(element: Element): number {
    const height = element.style.height;

    return typeof height === "number" ? height : ctx.deps.renderer.viewport.size().height;
  }

  /**
   * The node of one spacer of a windowed scroll. The node of the last render is kept while its
   * height holds, so a re-render with the same range writes no style and asks for no solve.
   *
   * @param scroll - The windowed scroll.
   * @param key - `TOP_SPACER` or `BOTTOM_SPACER`.
   * @param height - Its height now.
   * @returns The node.
   */
  function spacerOf(scroll: Element, key: string, height: number): DescriptionNode {
    const content = scroll.children[0] === undefined ? undefined : lookup(scroll.children[0]);
    const at = key === TOP_SPACER ? content?.children[0] : content?.children.at(-1);
    const spacer = at === undefined ? undefined : lookup(at);
    const style = spacer?.node.props.style as Style | undefined;

    return spacer?.key === key && style?.height === height ? spacer.node : spacerNode(key, height);
  }

  /**
   * The slots of a windowed scroll's window: the top spacer, `row(index)` for every index of the
   * range, the bottom spacer. A row that is not one node is one error per scroll, and an empty
   * slot of the row height stands in for it.
   *
   * @param scroll - The windowed scroll.
   * @param window - The window it is about to hold.
   * @returns The slots, top to bottom.
   */
  function slotsOf(scroll: Element, window: ScrollWindow): DescriptionNode[] {
    const { rows, rowHeight, first, last } = window;
    const row = scroll.node.props.row as (index: number) => JsxChild;
    const slots = [spacerOf(scroll, TOP_SPACER, first * rowHeight)];

    for (let index = first; index <= last; index += 1) {
      const slot = slotOf(row(index), index);

      if (slot === undefined) {
        logOnce(
          scroll,
          "ui:row-not-one-node",
          { key: scroll.key ?? scroll.identity, index },
          "error"
        );
      }

      slots.push(slot ?? emptySlot(index, rowHeight));
    }

    slots.push(spacerOf(scroll, BOTTOM_SPACER, (rows - last - 1) * rowHeight));

    return slots;
  }

  /**
   * The children an element is diffed against. A windowed scroll reads its props, re-clamps its
   * offset to the height of its rows, cuts the range at that offset and holds the slots of it; the
   * offset of a scroll that has not solved yet is 0.
   *
   * @param element - The element, its node of this render already set.
   * @returns The children.
   */
  function childrenFor(element: Element): readonly DescriptionNode[] {
    const props = element.type === "scroll" ? windowFormOf(element.node) : undefined;

    if (props === undefined) {
      delete element.window;

      return childrenOf(element.node);
    }

    const name = element.key ?? element.identity;

    if (props.rounded) logOnce(element, "ui:scroll-rows-rounded", { key: name });
    if (element.node.children.length > 0) {
      logOnce(element, "ui:scroll-children-ignored", { key: name });
    }

    const height = element.live ? element.rect.h : mountHeightOf(element);
    const offset = element.live
      ? modules.layout.clampScroll(element, props.rows * props.rowHeight, lookup)
      : 0;
    const range = modules.layout.windowOf(
      offset,
      height,
      props.rows,
      props.rowHeight,
      props.overscan
    );
    const window = {
      rows: props.rows,
      rowHeight: props.rowHeight,
      overscan: props.overscan,
      ...range
    };

    const slots = slotsOf(element, window);

    element.window = window;

    return childrenOf(element.node, slots);
  }

  /**
   * Creates one element and its subtree.
   *
   * @param root - The root being reconciled.
   * @param parent - The parent element, or nothing for a root element.
   * @param node - The node to place.
   * @param identity - The identity of the element.
   * @param instance - The identity of the nearest component instance.
   * @returns The new entity.
   */
  function enter(
    root: Root,
    parent: Element | undefined,
    node: DescriptionNode,
    identity: string,
    instance: string | undefined
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
      scrolledIn: windowing !== undefined
    };

    state.elements.set(entity, element);
    state.byIdentity.set(identity, entity);
    trackHost(state, element);
    registerKey(root, element);

    if (element.type === "input") fields.enter(element);
    if (element.type === "scroll") state.scrolls.add(entity);

    modules.layout.attach(element);
    diffChildren(root, element, childrenFor(element), instance);
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
   * Writes the draw order of a live child again: the `zIndex` of its style, or 0 once a child
   * that had one dropped it, so `renderer` sorts the siblings again. A child that never set one
   * carries no `Order`; a root keeps the order of its root.
   *
   * @param element - The element that changed.
   */
  function writeOrder(element: Element): void {
    if (element.parent === undefined) return;

    const current = ecs.get(element.entity, Order);
    const value = element.style.zIndex ?? 0;

    if (current === undefined) {
      if (element.style.zIndex !== undefined) ecs.add(element.entity, Order({ value }));

      return;
    }

    if (current.value !== value) ecs.set(element.entity, Order, { value });
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

    // Remove the extras that left the `components` prop, with the motion of their last change.
    for (const [name, previous] of element.extras) {
      if (next.has(name)) continue;

      element.extraHandles.get(name)?.cancel();
      element.extraHandles.delete(name);
      ecs.remove(element.entity, previous.type);
    }

    // Add a new, tag or missing extra whole; play or patch the changed fields of the rest.
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
        recordRest(element, value);

        continue;
      }

      recordRest(element, value);

      const values = { previous: previous.value, next: value.value };

      if (modules.layout.changeExtra(element, name, values, hintOf(element))) continue;

      const owned = ecs.typeOf(name)?.owned ?? [];

      ecs.set(element.entity, asHandle(value.type), livePatch(value.value, owned));
    }

    // Remember them for the next diff.
    element.extras = next;
  }

  /**
   * Writes the visual and input components of a live element again. A visual or an input the
   * element no longer carries is removed, so a variant can trade the rectangle for a nine-slice and
   * back, and a button that became disabled stops answering the gate. `Scroll` is only ever added:
   * its offset belongs to the finger, and a new look or a new rect never resets it. The extras of
   * the `components` prop are diffed last.
   *
   * @param element - The element that changed.
   */
  function writeLive(element: Element): void {
    writeOrder(element);

    // Remove the visuals and inputs the element no longer carries.
    const values = [...visualOf(element), ...inputOf(element)];

    for (const type of [...VISUALS, ...INPUTS]) {
      const carried = values.some(value => value.type === type);
      const isDropped = !carried && ecs.has(element.entity, type);

      if (isDropped) ecs.remove(element.entity, type);
    }

    // Add the ones the entity lacks; patch the fields of the rest, but never a tag or `Scroll`.
    for (const value of values) {
      if (!ecs.has(element.entity, value.type)) {
        ecs.add(element.entity, value);

        continue;
      }

      const isPatchable = value.value !== true && value.type !== Scroll;

      if (!isPatchable) continue;

      const owned = ecs.typeOf(value.type.componentName)?.owned ?? [];

      ecs.set(element.entity, asHandle(value.type), livePatch(value.value, owned));
    }

    writeExtras(element);
  }

  /**
   * Updates one live element from its new node.
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

    const previousNode = element.node;
    const is = isFlagsOf(node, {
      pressed: element.is.pressed,
      hover: element.is.hover,
      focus: element.is.focus,
      covered: root.covered
    });
    const style = styleFor(parentOf(element), node, is);
    const moved = modules.layout.affectsRect(element.style, style);
    const contentChanged =
      previousNode.props.content !== node.props.content ||
      previousNode.props.style !== node.props.style;

    const motion = node.props.motion as ElementMotion | undefined;
    const loopChanged = motion?.loop !== element.motion?.loop;

    element.node = node;
    element.is = is;
    element.style = style;
    element.motion = motion;
    element.instance = instance;
    trackHost(state, element);

    if (element.type === "input") fields.patch(element);

    // A new loop replaces the running one, and a motion without a loop stops it. An element that
    // has not entered yet starts the loop of its motion when it enters.
    if (loopChanged && element.entered) modules.layout.loop(element);

    if (moved || contentChanged) {
      modules.layout.applyStyle(element);
      root.needsSolve = true;
    }

    if (element.live) writeLive(element);
    // A new look that moves no rect moves the rest pose now; a new rect waits for the solve.
    if (element.live && !moved) {
      modules.layout.repose(element, parentRect(element), false, hintOf(element));
    }

    diffChildren(root, element, childrenFor(element), instance);
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

    if (element !== undefined) exitElement(element);

    return enter(root, parent, effective, identity, owner);
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
    const dropsRows = windowing !== undefined && parent.parent === windowing;

    for (const old of parent.children) {
      if (kept.has(old)) continue;

      const element = state.elements.get(old);

      if (element === undefined) continue;
      if (dropsRows) dropRow(element);
      else exitElement(element);
    }

    // Keep the new list; the same children in the same order need no new placement.
    const same =
      next.length === parent.children.length &&
      next.every((entity, index) => parent.children[index] === entity);

    parent.children = next;

    if (same) return;

    // Re-place the children in the layout once, and solve again.
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
   */
  function exitElement(element: Element): void {
    forgetSubtree(element);
    forgetInstances(state, element.identity);
    state.exiting.add(element.entity);
    exitSubtree(element);
  }

  /**
   * Drops a row that left the window of a windowed scroll: its keys and its instances are
   * forgotten, so its local state is lost, and the subtree despawns and frees its Yoga nodes now.
   * No `exit` hook plays and nothing is tagged `Exiting`: leaving the window is not a removal.
   *
   * @param element - The row that left the window.
   */
  function dropRow(element: Element): void {
    forgetSubtree(element);
    forgetInstances(state, element.identity);
    despawnTree(element);
  }

  /**
   * Plays the exit hook of an element and of everything under it. A child keeps its rect and its
   * `Exiting` tag until the whole subtree stopped moving.
   *
   * @param element - The element that leaves, or one of its children.
   */
  function exitSubtree(element: Element): void {
    state.hosts.delete(element.entity);
    state.scrolls.delete(element.entity);
    modules.layout.exit(element);

    if (element.type === "input") fields.exit(element);

    for (const child of element.children) {
      const childElement = state.elements.get(child);

      if (childElement !== undefined) exitSubtree(childElement);
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

    return element.children.every(child => {
      const childElement = state.elements.get(child);

      return childElement === undefined || subtreeSettled(childElement);
    });
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

    state.hosts.delete(element.entity);
    state.scrolls.delete(element.entity);
    state.exiting.delete(element.entity);
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

      if (!subtreeSettled(element)) continue;

      despawnTree(element);
    }

    // Drop a removed root once its element tree is gone, and close its popup.
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
   * the `change` hook already moves it.
   *
   * @param element - The live element to apply.
   * @param parent - The rect of its parent, or nothing for a root.
   */
  function applyLive(element: Element, parent: Rect | undefined): void {
    // Commit a moved rect, rewrite the components and play the `change` hook with the routed hint.
    const hint = hintOf(element);
    let hooked = false;

    if (element.moved) {
      modules.layout.commit(element, parent);
      writeLive(element);
      hooked = modules.layout.change(element, element.previous, hint);
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
    const root = state.roots.get(element.root) ?? { layer: "ui", order: 0 };

    element.extras = extrasOf(element);
    warnOwned(element);

    for (const value of element.extras.values()) recordRest(element, value);
    for (const value of componentsOf(element, root)) ecs.add(element.entity, value);

    element.live = true;
  }

  /**
   * Gives every element of a solved root its components, its rest pose and its motion. A live
   * element whose rect moved gets its `Box`, its visual size and its `change.Box` motion; one
   * whose rest pose moved (a new rect, a new fit scale) plays `change.Transform` or takes it.
   *
   * @param element - The element to apply.
   */
  function applyRects(element: Element): void {
    // Apply this element: a live one moves, a new one spawns its components.
    const parent = parentRect(element);

    if (element.live) {
      applyLive(element, parent);
    } else {
      applyFirst(element, parent);
    }

    element.moved = false;

    // Then its children, top-down.
    for (const child of element.children) {
      const childElement = lookup(child);

      if (childElement !== undefined) applyRects(childElement);
    }
  }

  /**
   * Plays the enter hook of an element whose spawn has just been applied. The world calls it from
   * the `Box` hook, at the flush of phase `layout`, so the entity carries every component and the
   * first `sync` has not run: the element is never drawn at its rest pose by mistake. A row a
   * range change scrolled in is not new: it plays no `enter` hook, only its loop starts.
   *
   * @param entity - The entity the `Box` was attached to.
   */
  function playEnter(entity: Entity): void {
    const element = state.elements.get(entity);

    if (element === undefined || element.entered) return;

    element.entered = true;

    if (element.scrolledIn) modules.layout.loop(element);
    else modules.layout.enter(element);
  }

  /**
   * Reconciles one root from the node its `Tree` carries.
   *
   * @param root - The root to reconcile.
   */
  function reconcileRoot(root: Root): void {
    const identity = String(root.entity);

    root.element = diffNode(root, undefined, root.tree, 0, identity);
  }

  /**
   * The live scroll containers, which the frame step moves with the finger. Read from the set the
   * enter fills and the exit empties, so an idle frame walks no other element.
   *
   * @returns Every live element whose tag is `scroll`.
   */
  function scrollContainers(): Element[] {
    const containers: Element[] = [];

    for (const entity of state.scrolls) {
      const element = state.elements.get(entity);

      if (element?.live === true) containers.push(element);
    }

    return containers;
  }

  /**
   * Moves the window of a windowed scroll to a new range: only the list's subtree is diffed, on
   * the stored node of the scroll, so no view above it runs. Rows that leave are dropped, rows that
   * enter play no `enter` hook, and the root solves once.
   *
   * @param root - The root of the scroll.
   * @param scroll - The live windowed scroll.
   * @param window - The window it held.
   * @param range - The range it holds now.
   */
  function moveWindow(root: Root, scroll: Element, window: ScrollWindow, range: RowRange): void {
    const moved = { ...window, ...range };

    windowing = scroll.entity;

    try {
      // The window moves only once every row of it was built: a row callback that throws leaves
      // the list as it was, and the next range step tries again.
      const slots = slotsOf(scroll, moved);

      scroll.window = moved;
      diffChildren(root, scroll, childrenOf(scroll.node, slots), scroll.instance);
    } finally {
      windowing = undefined;
    }

    root.needsSolve = true;
    state.windowRenders += 1;
  }

  /**
   * The range step: every live windowed scroll cuts its range at this frame's offset, after the
   * scroll step and before any root is diffed, so a row never arrives one frame late. A range that
   * moved re-renders the list; a row callback that throws fails that root alone.
   *
   * @param containers - The live scroll containers of this frame.
   */
  function stepWindows(containers: readonly Element[]): void {
    for (const scroll of containers) {
      const window = scroll.window;
      const root = state.roots.get(scroll.root);
      const isGone = !state.scrolls.has(scroll.entity) || !state.elements.has(scroll.entity);

      if (window === undefined || root === undefined || isGone) continue;
      if (state.removing.has(root.entity)) continue;

      const offset = ecs.get(scroll.entity, Scroll)?.offset ?? 0;
      const { rows, rowHeight, overscan } = window;
      const range = modules.layout.windowOf(offset, scroll.rect.h, rows, rowHeight, overscan);

      if (range.first === window.first && range.last === window.last) continue;

      try {
        moveWindow(root, scroll, window, range);
      } catch (error) {
        ctx.log.error("ui:root-failed", { root: root.name }, asError(error));
      }
    }
  }

  /**
   * Collects the roots that have work this frame: a changed tree, a dirty instance or style, and
   * every root when the viewport changed.
   *
   * @param viewportChanged - Whether the viewport moved since the last frame.
   * @returns The roots to reconcile, in mount order.
   */
  function dirtyRoots(viewportChanged: boolean): Root[] {
    const changed = entitySet(ecs.changed(WORLD_TREE));

    return [...state.roots.values()].filter(root => {
      if (state.removing.has(root.entity)) return false;
      if (viewportChanged) {
        root.needsSolve = true;

        return true;
      }

      return root.dirty || changed.has(root.entity);
    });
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
   * The first of the two systems of phase `layout`: the sweep, the popups that may leave, the
   * pull of the text being typed, the scroll offsets and the windowed ranges, the viewport, the
   * dirty roots and the hosted views.
   */
  function reconcile(): void {
    // Despawn what finished exiting, and count this pass.
    sweep();
    state.reconciles += 1;

    // A released popup leaves once the flow rests on a node that shows none of its component.
    settlePopups(ctx, state, unmountRoot);

    // The text being typed reaches the local of its component before the roots re-render.
    fields.pull();

    // Move the scroll containers with the finger, then cut the windowed ranges at that offset,
    // before any root is diffed.
    const containers = scrollContainers();

    modules.layout.scroll(containers, lookup);
    stepWindows(containers);

    // Reconcile every root whose tree, instance or style changed, and all of them on a new viewport.
    const viewportChanged = modules.styles.useViewport(ctx.deps.renderer.viewport.size());

    for (const root of dirtyRoots(viewportChanged)) reconcileDirtyRoot(root);

    // Give the views a slot hosts their parent, take it back where the slot left, and publish the
    // frame's counters.
    hostViews(ctx, state);
    writeCounters();
  }

  /**
   * Copies the counters of the two modules into the resource the acceptance tests read.
   */
  function writeCounters(): void {
    const counters = ecs.resource(UiCounters);
    const { nodes, measured, solves } = modules.layout.counters();

    counters.nodes = nodes;
    counters.measured = measured;
    counters.solves = solves;
    counters.reconciles = state.reconciles;
    counters.windowRenders = state.windowRenders;
  }

  /**
   * The second system of phase `layout`: one solve per marked root, then the rects, the rest
   * poses and the hooks. The hints released since the last frame step are dropped at its end, so
   * the `change.Box` and `change.Transform` hooks the solve plays get the hint the reconcile
   * routed, and the next frame starts with none.
   */
  function solve(): void {
    const viewport = modules.styles.viewport();
    const size: Rect = { x: 0, y: 0, w: viewport?.width ?? 0, h: viewport?.height ?? 0 };
    let changed = false;

    for (const root of state.roots.values()) {
      const element = root.element === undefined ? undefined : lookup(root.element);

      if (!root.needsSolve || element === undefined) continue;

      modules.layout.solve(element, size, lookup);
      root.needsSolve = false;
      applyRects(element);
      changed = true;
    }

    if (changed) ctx.deps.time.wake();

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
      }

      return;
    }

    const tree = ecs.get(entity, WORLD_TREE);

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
      covered: false
    });
  }

  /**
   * Starts the teardown of a root: every element exits with its motion, then the sweep frees the
   * nodes and despawns the root entity.
   *
   * @param entity - The root entity.
   */
  function unmountRoot(entity: Entity): void {
    const root = state.roots.get(entity);

    if (root === undefined || state.removing.has(entity)) return;

    const element = root.element === undefined ? undefined : lookup(root.element);

    state.removing.add(entity);

    if (element !== undefined) exitElement(element);

    ctx.deps.time.wake();
  }

  /**
   * Re-resolves the style of one element whose pointer or focus flag changed: a press, a release,
   * the mouse coming over it or leaving it, the keyboard focus arriving or leaving. A new rect
   * waits for the solve; a new look and a new rest pose apply now.
   *
   * @param entity - The element entity.
   * @param flag - Which flag changed.
   * @param on - Its value now.
   */
  function markPointer(entity: Entity, flag: PointerFlag, on: boolean): void {
    const element = state.elements.get(entity);

    if (element === undefined) return;

    element.is = { ...element.is, [flag]: on };

    const style = styleFor(parentOf(element), element.node, element.is);
    const root = state.roots.get(element.root);
    const moved = modules.layout.affectsRect(element.style, style);

    element.style = style;

    if (moved) {
      modules.layout.applyStyle(element);

      if (root !== undefined) root.needsSolve = true;
    }

    if (root !== undefined) root.dirty = true;
    if (!element.live) return;

    writeLive(element);

    if (!moved) modules.layout.repose(element, parentRect(element), false);
  }

  return { reconcile, solve, mountRoot, unmountRoot, markPointer, playEnter, sweep };
}
