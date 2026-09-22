/* eslint-disable unicorn/prevent-abbreviations -- "props" is the JSX word for the attributes of a tag; another name would hide the contract. */
/**
 * @file ui/jsx — type definitions: the description node the runtime builds, what
 * `defineComponent` returns, the records the reconcile keeps and the module shape.
 */
import type { Json } from "../../model/types";
import type { MotionHandle, ProjectionMotion } from "../../world/projection/types";
import type { Entity } from "../../world/types";
import type { IsFlags, ResolvedStyle, Style } from "../styles/types";

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
 * The motion hooks of one element: the hook triple of `world.projection`, which `defineMotion`
 * of `anim` returns.
 *
 * @example
 * ```ts
 * const motion: ElementMotion = { enter: view => view.toRest(Transform, { ms: 250 }) };
 * ```
 */
export type ElementMotion = ProjectionMotion<unknown>;

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
 * A component that names outcomes, which is what `popup` takes.
 *
 * @example
 * ```ts
 * const reward: PopupComponent<{ gold: number }> = RewardPopup;
 * ```
 */
export type PopupComponent<Properties extends object> = ComponentDefinition<
  Properties,
  object,
  Record<string, unknown>
>;

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
 * One live element: the entity, the Yoga node, the resolved style and the place in the tree.
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
  handles: MotionHandle[];
  motion: ElementMotion | undefined;
  parent: Entity | undefined;
  children: Entity[];
  instance: string | undefined;
  live: boolean;
  dropKey: (() => void) | undefined;
};

/**
 * One reconciled tree: a projection view or a popup, with the flags the frame step reads.
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
  popup: { close: () => void } | undefined;
};

/**
 * jsx module state.
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
  reconciles: number;
};

/**
 * One node of the snapshot `tree()` answers with.
 *
 * @example
 * ```ts
 * const node: UiNode = {
 *   key: "coins", type: "text", rect: { x: 0, y: 0, w: 80, h: 40 },
 *   style: {}, state: { pressed: false, disabled: false, active: false, selected: false },
 *   children: []
 * };
 * ```
 */
export type UiNode = {
  key: string | undefined;
  type: string;
  rect: { x: number; y: number; w: number; h: number };
  style: ResolvedStyle;
  state: IsFlags;
  local?: Record<string, unknown>;
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
  rule: "tap-target" | "text-overflow" | "absolute-without-reason";
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
  motion?: ElementMotion;
  children?: JsxChild;
};

/**
 * The payload a button sends to the gate, or the patch it writes into the nearest instance.
 *
 * @example
 * ```ts
 * const props: ButtonProps = { intent: "claim", payload: { orderId: "o1" } };
 * ```
 */
export type ButtonProps = CommonProps &
  (
    | { intent?: string; payload?: Json; local?: never }
    | { intent?: never; payload?: never; local?: Record<string, unknown> }
  );

/**
 * jsx module shape, injected onto the plugin API. `tree`, `find` and `lint` are the public half.
 */
export type JsxModule = {
  tree(): UiNode;
  find(key: string): Entity | undefined;
  lint(): readonly Finding[];
  reconcile(): void;
  solve(): void;
  register(definition: AnyComponentDefinition): void;
  mountRoot(entity: Entity, name: string, layer: string, popup?: { close: () => void }): void;
  unmountRoot(entity: Entity): void;
  applyTap(entity: Entity): void;
  markPressed(entity: Entity, pressed: boolean): void;
};
