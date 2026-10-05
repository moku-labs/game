/* eslint-disable unicorn/prevent-abbreviations -- "props" is the JSX word for the attributes of a tag; another name would hide the contract. */
/**
 * @file ui/jsx — type definitions: the description node the runtime builds, what
 * `defineComponent` returns, the records the reconcile keeps and the module shape.
 */

import type { Hint } from "../../flow/types";
import type { Message } from "../../i18n/types";
import type { KeyInput, RawSample } from "../../input/types";
import type { Json } from "../../model/types";
import type { TransformValue } from "../../renderer/components";
import type {
  ChangeHook,
  Motion,
  MotionHandle,
  ProjectionMotion,
  ViewHandle
} from "../../world/projection/types";
import type { AnyComponentValue, Entity } from "../../world/types";
import type { BoxValue } from "../components";
import type { IsFlags, ResolvedStyle, Style } from "../styles/types";
import type { ElementComponents } from "./intrinsics";

/**
 * One node of an element description, as the JSX runtime builds it. `key` is the third argument
 * of `jsx`, never a member of `props`.
 *
 * @example
 * ```ts
 * const node: DescriptionNode = { type: "row", key: "tabs", props: {}, children: [] };
 * ```
 */
export type DescriptionNode = {
  type: string;
  key?: string;
  props: Record<string, unknown>;
  children: DescriptionNode[];
};

/**
 * What may sit between the tags of a node before `flatten` is done with it: nodes, arrays,
 * strings, numbers and the three values that drop.
 *
 * @example
 * ```ts
 * const child: JsxChild = "5 coins";
 * ```
 */
export type JsxChild =
  | DescriptionNode
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly JsxChild[];

/**
 * One `change` hook of a ui element: its handle, the value before and the value after.
 *
 * @example
 * ```ts
 * const moved: ElementChange<BoxValue> = (view, previous, next) =>
 *   next.y > previous.y ? view.toRest(Transform, { ms: 200 }) : undefined;
 * ```
 */
export type ElementChange<Value> = (
  view: ViewHandle<unknown>,
  previous: Value,
  next: Value,
  hint?: Hint
) => Motion;

/**
 * The motion hooks of one element: the hook triple of `world.projection`, which `defineMotion`
 * of `anim` returns. `ui` plays the `change` hooks of `Box` (the rects), of `Transform` (the rest
 * poses) and of every extra component of the `components` prop (its values before and after). A
 * hook for any other component name is accepted, so every `defineMotion` result fits, and `ui`
 * never plays it. Every hook gets the hint routed to the element's key in that frame step.
 *
 * @example
 * ```ts
 * // An order card that grows into its ready pose sways once on the way.
 * const cardMotion: ElementMotion = {
 *   change: {
 *     Transform: (view, previous, next) =>
 *       next.scale > previous.scale
 *         ? view.all([
 *             view.toRest(Transform, { ms: 240 }),
 *             view.tween(Transform, { rotation: 0.12 }, { ms: 520, additive: true })
 *           ])
 *         : view.toRest(Transform, { ms: 240 })
 *   }
 * };
 * ```
 */
export type ElementMotion = Omit<ProjectionMotion<unknown>, "change"> & {
  readonly change?: {
    readonly [component: string]: ChangeHook<never>;
    Box?(view: ViewHandle<unknown>, previous: BoxValue, next: BoxValue, hint?: Hint): Motion;
    Transform?(
      view: ViewHandle<unknown>,
      previous: TransformValue,
      next: TransformValue,
      hint?: Hint
    ): Motion;
  };
};

/**
 * What a game hands `defineComponent`: the local state one instance starts with, the outcomes a
 * popup of it resolves with, and the view that runs at every reconcile.
 *
 * @example
 * ```ts
 * const spec: ComponentSpec<{ volume: number }, { tab: string }, never> = {
 *   local: { tab: "audio" },
 *   view: (props, local) => ({ type: "column", props: {}, children: [] })
 * };
 * ```
 */
export type ComponentSpec<Properties extends object, Local extends object, Outcomes> = {
  readonly local?: Local;
  readonly outcomes?: Outcomes;
  view(props: Properties, local: Local): DescriptionNode;
};

/**
 * What `defineComponent` returns: a function JSX may call, carrying the name, the outcomes and
 * the local state a fresh instance is cloned from.
 *
 * @example
 * ```ts
 * const Settings = defineComponent("Settings", { view: () => ({ type: "column", props: {}, children: [] }) });
 * Settings.name; // "Settings"
 * ```
 */
export type ComponentDefinition<
  Properties extends object = object,
  Local extends object = object,
  Outcomes = undefined
> = {
  (props: Properties): DescriptionNode;
  readonly name: string;
  readonly outcomes: Outcomes;
  readonly local: Local;
  readonly view: (props: Properties, local: Local) => DescriptionNode;
  readonly isUiComponent: true;
};

/**
 * A component that names outcomes, which is what `popup` takes. `Local` stays a parameter
 * because the `local` argument of `view` is contravariant: pinned to `object` it would refuse
 * every component that keeps local state.
 *
 * @example
 * ```ts
 * const settings: PopupComponent<{ volume: number }, { tab: string }> = Settings;
 * ```
 */
export type PopupComponent<
  Properties extends object,
  Local extends object = object
> = ComponentDefinition<Properties, Local, Record<string, unknown>>;

/**
 * A component definition with its type arguments erased, as the registry stores it.
 */
export type AnyComponentDefinition = ComponentDefinition<never, never, unknown>;

/**
 * One live instance of a component: the local state kept by identity across renders.
 */
export type Instance = {
  identity: string;
  component: string;
  local: Record<string, unknown>;
  props: object;
  dirty: boolean;
};

/**
 * The range a windowed scroll holds and what it was cut with: `rows` rows of `rowHeight`, the
 * indexes `first` to `last` alive, `overscan` of them beyond each edge of the viewport. `last` is
 * `first - 1` for an empty list.
 *
 * @example
 * ```ts
 * // P18's list scrolled to -3840 u: 24 of its 1000 rows exist.
 * const window: ScrollWindow = { rows: 1000, rowHeight: 120, overscan: 5, first: 27, last: 50 };
 * ```
 */
export type ScrollWindow = {
  rows: number;
  rowHeight: number;
  overscan: number;
  first: number;
  last: number;
};

/**
 * One live element: the entity, the Yoga node, the resolved style and the place in the tree.
 * `rect` is natural: under a `fit` ancestor it is the rect before that ancestor's scale. `fit`
 * is the element's own fit scale (1 without `fit: "contain"`), and `rest` the rest `Transform`
 * last written for it. `loop` is the motion of the running `loop` hook, kept apart from
 * `handles`: it never ends, so the exit sweep must not wait for it. `extras` holds the values of
 * the `components` prop added last time, by component name; `extraHandles` the motion the last
 * `change` hook of each of them returned; `warnedOwned` the names of the `components` values the
 * element owns that were already logged. A windowed scroll carries its `window` and the one-time
 * warnings of its props in `warned`; `scrolledIn` marks an element a range change of a windowed
 * scroll created: it plays no `enter` hook. A text or an icon that sizes itself keeps in
 * `measuredSize` what its measure function last answered, before Yoga's clamp: a bound text whose
 * new string measures the same asks for no solve.
 */
export type Element = {
  entity: Entity;
  identity: string;
  type: string;
  key: string | undefined;
  parentType: string | undefined;
  root: Entity;
  node: DescriptionNode;
  style: ResolvedStyle;
  is: IsFlags;
  rect: { x: number; y: number; w: number; h: number };
  previous: { x: number; y: number; w: number; h: number };
  moved: boolean;
  fit: number;
  rest: TransformValue;
  handles: MotionHandle[];
  loop: MotionHandle | undefined;
  motion: ElementMotion | undefined;
  parent: Entity | undefined;
  children: Entity[];
  instance: string | undefined;
  live: boolean;
  entered: boolean;
  dropKey: (() => void) | undefined;
  extras: ReadonlyMap<string, AnyComponentValue>;
  extraHandles: Map<string, MotionHandle>;
  warnedOwned: Set<string>;
  warned: Set<string>;
  scrolledIn: boolean;
  window?: ScrollWindow;
  measuredSize?: { width: number; height: number };
};

/**
 * The popup side of a root: the handler that shows it now and the root it was opened over.
 * `released` turns true when that handler's effect ended (answered, or its node aborted): the
 * root then stays until the flow rests on a node that shows no popup of its component.
 */
export type PopupLink = {
  close: () => void;
  released?: boolean;
  over?: Entity;
};

/**
 * One reconciled tree: a projection view or a popup, with the flags the frame step reads.
 * `covered` is true while the root is kept under another popup; every element of the root then
 * resolves `is.covered`.
 */
export type Root = {
  entity: Entity;
  name: string;
  tree: DescriptionNode;
  layer: string;
  order: number;
  dirty: boolean;
  needsSolve: boolean;
  element: Entity | undefined;
  popup: PopupLink | undefined;
  covered: boolean;
};

/**
 * Where the focus ring was last drawn: the layer and order of its root, the rect grown by the
 * ring offset, and the corner radius.
 */
export type DrawnRing = {
  layer: string;
  order: number;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
};

/**
 * The keyboard focus: the focused element, the two entities of the ring drawn around it, where
 * the ring was last drawn, and whether ui itself is tapping, so its own Enter tap does not read
 * as a pointer tap that clears the focus.
 */
export type FocusState = {
  entity: Entity | undefined;
  ring: { halo: Entity; ring: Entity } | undefined;
  drawn: DrawnRing | undefined;
  tapping: boolean;
  /** The focus came from a finger on a text field: the element is focused, no ring is drawn. */
  ringless: boolean;
};

/**
 * The text of the field being edited, as the frame step last read it from the hidden input, or
 * as `fill` wrote it. Indexes count UTF-16 units, as the DOM does.
 *
 * @example
 * ```ts
 * // "Alex" typed, the caret at the end, nothing selected.
 * const mirror: Mirror = { value: "Alex", selectionStart: 4, selectionEnd: 4, direction: "none" };
 * ```
 */
export type Mirror = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  direction: "forward" | "backward" | "none";
};

/**
 * The part of the value an IME is composing, between `compositionstart` and `compositionend`.
 *
 * @example
 * ```ts
 * const composing: Composing = { start: 4, end: 6 };
 * ```
 */
export type Composing = { start: number; end: number };

/** The keyboard a text field opens. */
export type FieldKind = "text" | "number" | "email";

/** The four ui-owned entities a field is drawn with besides its own, each with `Parent` = field. */
export type FieldParts = { selection: Entity; text: Entity; caret: Entity; composing: Entity };

/**
 * One text field: its entity and the props of the `input` tag, filled at enter and dropped at the
 * despawn. `instance` is the nearest component instance, the one whose `local` the field writes.
 */
export type Field = {
  entity: Entity;
  key: string | undefined;
  root: Entity;
  instance: string | undefined;
  local: string;
  submit: string | undefined;
  maxLength: number | undefined;
  kind: FieldKind;
  textStyle: string;
  placeholder: string | Message | undefined;
  parts: FieldParts | undefined;
  /** What the parts were last written with, so a field laid out the same way writes nothing. */
  drawn: string | undefined;
  /**
   * A fingerprint of what the field was last laid out from, so a still field is neither measured
   * nor laid out. `undefined` lays it out again: before its first placement, and after `text`
   * resolved its text part again, as it does when a font arrives.
   */
  inputs: string | undefined;
};

/**
 * Where the keyboard stands, in CSS px: the height it covers at the bottom of the window, the
 * window height it was read with, and the lift the editing field's root is moved up by.
 */
export type Keyboard = { inset: number; innerHeight: number; lift: number };

/**
 * The root the keyboard lift was last written on: its root element, the lift in reference units,
 * and the rest pose it was added to, so a new rest is lifted again.
 */
export type Lifted = { element: Entity; units: number; rest: TransformValue };

/**
 * The text input: the one hidden DOM input (none headless), the field being edited, the mirror of
 * the text, the composing range, the keyboard, the root lifted above it, the listeners of the
 * element (removed in `onStop`) and the viewport watcher (removed when the editing ends).
 */
export type TextState = {
  element: HTMLInputElement | undefined;
  editing: Entity | undefined;
  mirror: Mirror;
  composing: Composing | undefined;
  keyboard: Keyboard;
  lifted: Lifted | undefined;
  placed: string | undefined;
  watching: (() => void) | undefined;
  cleanups: Array<() => void>;
};

/**
 * jsx module state. `hosts` holds the elements with a `hosts` prop; `hosted` maps a world view to
 * the element that hosts it; `fields` holds the text fields by entity. `hints` buffers the hints
 * released since the last frame step; `scrolls` holds the scroll containers; `windowRenders`
 * counts the re-renders of a windowed list its range made.
 */
export type JsxState = {
  components: Map<string, AnyComponentDefinition>;
  roots: Map<Entity, Root>;
  elements: Map<Entity, Element>;
  byIdentity: Map<string, Entity>;
  byKey: Map<Entity, Map<string, Entity>>;
  instances: Map<string, Instance>;
  exiting: Set<Entity>;
  removing: Set<Entity>;
  hosts: Set<Entity>;
  hosted: Map<Entity, Entity>;
  reconciles: number;
  focus: FocusState;
  fields: Map<Entity, Field>;
  text: TextState;
  hints: Hint[];
  scrolls: Set<Entity>;
  windowRenders: number;
};

/**
 * One node of the snapshot `tree()` answers with. `rect` is natural: under a `fit` ancestor it
 * is the rect before that ancestor's scale. An element with `fit: "contain"` adds `fitScale`,
 * the scale it is drawn at. An `input` adds `value`: the text being typed while it is edited,
 * else the local field it writes. A windowed `scroll` adds `window`: the rows that exist, which
 * are the children of its content, and how many the list has.
 *
 * @example
 * ```ts
 * // A profile screen before the player types: its name field shows the value, not its parts.
 * const field = app.ui.tree().children[0];
 * field?.key; // "nickField"
 * field?.rect; // { x: 0, y: 0, w: 400, h: 80 }
 * field?.value; // ""
 * field?.children; // []
 * ```
 */
export type UiNode = {
  key: string | undefined;
  type: string;
  rect: { x: number; y: number; w: number; h: number };
  style: ResolvedStyle;
  state: IsFlags;
  local?: Record<string, unknown>;
  fitScale?: number;
  value?: string;
  /**
   * The rows of a windowed scroll that exist and how many the list has.
   *
   * @example
   * ```ts
   * // P18's shop list of 1000 rows, 120 u each in 1600 u, scrolled to -3840 u: 24 rows exist.
   * const window: UiNode["window"] = { first: 27, last: 50, rows: 1000 };
   * ```
   */
  window?: { first: number; last: number; rows: number };
  children: UiNode[];
};

/**
 * One thing `lint()` found on the live screen.
 *
 * @example
 * ```ts
 * const finding: Finding = { rule: "tap-target", key: "claim", detail: "32x32 pt" };
 * ```
 */
export type Finding = {
  rule:
    | "tap-target"
    | "text-overflow"
    | "absolute-without-reason"
    | "nine-slice-clipped"
    | "z-index-on-root";
  key: string;
  detail: string;
};

/**
 * What the common props of every intrinsic tag accept. A tag's own props are added to it.
 *
 * @example
 * ```ts
 * const props: CommonProps = { style: { gap: 8 }, state: { active: true } };
 * ```
 */
export type CommonProps = {
  key?: string;
  style?: Style;
  state?: { active?: boolean; disabled?: boolean; selected?: boolean };
  /** The motion hooks; `undefined` written out stops a running loop, as leaving it out does. */
  motion?: ElementMotion | undefined;
  children?: JsxChild;
  /** Extra components the element's entity carries, beside the ones the tag writes itself. */
  components?: ElementComponents;
};

/**
 * The payload a button sends to the gate, or the patch it writes into the nearest instance.
 * `escape` makes it the control the Escape key taps while its root is the top one.
 *
 * @example
 * ```ts
 * const props: ButtonProps = { intent: "claim", payload: { orderId: "o1" } };
 * const close: ButtonProps = { intent: "close", escape: true };
 * ```
 */
export type ButtonProps = CommonProps & { escape?: boolean } & (
    | { intent?: string; payload?: Json; local?: never }
    | { intent?: never; payload?: never; local?: Record<string, unknown> }
  );

/**
 * The three state flags set on an element from outside the markup: `input` tags it `Pressed`
 * from down to up and `PointerOver` while an idle mouse or pen is over it, and the keyboard
 * focus sets `focus`.
 */
export type PointerFlag = "pressed" | "hover" | "focus";

/**
 * jsx module shape, injected onto the plugin API. `tree`, `find`, `lint` and `fill` are the public
 * half.
 */
export type JsxModule = {
  tree(): UiNode;
  find(key: string): Entity | undefined;
  lint(): readonly Finding[];
  fill(key: string, value: string): boolean;
  open(): void;
  pointer(sample: RawSample): void;
  tapped(entity: Entity): void;
  reconcile(): void;
  solve(): void;
  register(definition: AnyComponentDefinition): void;
  /** Swaps the registered definition of that name, or adds it; the dev hot swap calls it. */
  replace(definition: AnyComponentDefinition): void;
  /** Marks every root for a reconcile and a solve, so each view runs again on the next frame. */
  refreshAll(): void;
  mountRoot(entity: Entity, name: string, layer: string, popup?: PopupLink): void;
  unmountRoot(entity: Entity): void;
  reclaimPopup(component: string, props: object, link: PopupLink): Entity | undefined;
  coverPopup(over: string, coverer: Entity): void;
  releasePopup(entity: Entity, link: PopupLink): void;
  releaseHosted(): void;
  applyTap(entity: Entity): void;
  markPointer(entity: Entity, flag: PointerFlag, on: boolean): void;
  playEnter(entity: Entity): void;
  key(input: KeyInput): boolean;
  blur(): void;
};
