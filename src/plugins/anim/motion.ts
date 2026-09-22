/**
 * @file anim plugin — `defineMotion`: the sugar that turns named poses into the three projection
 * motion hooks of `world`. Pure, no ctx: it only builds hooks that call `ViewHandle`, so a UI
 * element and a projection view play the same way through the same driver.
 */
import type {
  NineSliceValue,
  ShapeValue,
  SpriteValue,
  TransformValue
} from "../renderer/components";
import { NineSlice, Shape, Sprite, Transform } from "../renderer/components";
import type { AnyComponent } from "../world/ecs/types";
import type { ChangeHooks } from "../world/projection/types";
import type {
  ChangeHook,
  Ease,
  Motion,
  NumericFields,
  ProjectionMotion,
  ViewHandle
} from "../world/types";
import { asComponent } from "./components";

/** What a motion transition runs for when the author named nothing else. */
const DEFAULT_TRANSITION_MS = 250;

/** What a motion transition eases with when the author named nothing else. */
const DEFAULT_TRANSITION_EASE: Ease = "out";

/**
 * The display components a pure `defineMotion` can name. A hook has no context, so it can only
 * reach the components `anim` itself imports: the four of `renderer` that carry numeric fields.
 *
 * @example
 * ```ts
 * type Fields = MotionComponents["Transform"]; // { x: number; y: number; rotation: number; scale: number }
 * ```
 */
export type MotionComponents = {
  Transform: TransformValue;
  Sprite: SpriteValue;
  NineSlice: NineSliceValue;
  Shape: ShapeValue;
};

/**
 * One named pose: the numeric fields it gives each component it names.
 *
 * @example
 * ```ts
 * const hidden: MotionState = { Transform: { scale: 0.8 }, Shape: { alpha: 0 } };
 * ```
 */
export type MotionState = {
  readonly [Name in keyof MotionComponents]?: Readonly<
    Partial<NumericFields<MotionComponents[Name]>>
  >;
};

/**
 * The resolved way between two poses: `defineMotion` fills both fields in, so every track a hook
 * starts carries a concrete duration and curve.
 *
 * @example
 * ```ts
 * const transition: MotionTransition = { ms: 150, ease: "out" };
 * ```
 */
export type MotionTransition = { readonly ms: number; readonly ease: Ease };

/**
 * What `defineMotion` is given: the named poses, how long the way between them takes, and which
 * hooks to build.
 *
 * @example
 * ```ts
 * const spec: MotionSpec = {
 *   states: { hidden: { Transform: { scale: 0.8 } } },
 *   transition: { ms: 150, ease: "out" },
 *   on: { enter: "hidden", exit: "hidden", change: ["Transform"] }
 * };
 * ```
 */
export type MotionSpec = {
  readonly states: Readonly<Record<string, MotionState>>;
  readonly transition?: { readonly ms?: number; readonly ease?: Ease };
  readonly on: {
    readonly enter?: string;
    readonly exit?: string;
    readonly change?: readonly (keyof MotionComponents & string)[];
  };
};

/**
 * The component type behind one of the four names a motion state may use.
 *
 * @param name - The component name a state named.
 * @returns The component type, or `undefined` for a name `anim` cannot resolve.
 * @example
 * ```ts
 * componentByName("Transform")?.componentName; // "Transform"
 * componentByName("Nope"); // undefined
 * ```
 */
function componentByName(name: string): AnyComponent | undefined {
  if (name === Transform.componentName) return asComponent(Transform);
  if (name === Sprite.componentName) return asComponent(Sprite);
  if (name === NineSlice.componentName) return asComponent(NineSlice);
  if (name === Shape.componentName) return asComponent(Shape);

  return undefined;
}

/**
 * The components and fields of one named pose, in the order the author wrote them, with the
 * names `anim` cannot resolve left out.
 *
 * @param state - The named pose.
 * @returns One entry per resolvable component.
 */
function posesOf(state: MotionState): Array<[AnyComponent, Record<string, number>]> {
  const poses: Array<[AnyComponent, Record<string, number>]> = [];

  for (const [name, fields] of Object.entries(state)) {
    const component = componentByName(name);

    if (component !== undefined && fields !== undefined) poses.push([component, { ...fields }]);
  }

  return poses;
}

/**
 * Reads one named pose off the spec.
 *
 * @param spec - What `defineMotion` was given.
 * @param name - Name of the state, or nothing.
 * @returns The pose, or `undefined` when no state was named.
 */
function stateOf(spec: MotionSpec, name: string | undefined): MotionState | undefined {
  return name === undefined ? undefined : spec.states[name];
}

/**
 * The enter hook: the element appears in the named pose and comes to rest from there.
 *
 * @param view - The view handle the hook was given.
 * @param state - The named pose.
 * @param transition - How long the way home takes.
 * @returns One motion over every component the pose names.
 */
function playEnter(
  view: ViewHandle<unknown>,
  state: MotionState,
  transition: MotionTransition
): Motion {
  const poses = posesOf(state);

  for (const [component, fields] of poses) view.set(component, fields);

  return view.all(poses.map(([component]) => view.toRest(component, transition)));
}

/**
 * The exit hook: the element tweens into the named pose and its rest pose is left alone, so the
 * view keeps the rect it had.
 *
 * @param view - The view handle the hook was given.
 * @param state - The named pose.
 * @param transition - How long the way out takes.
 * @returns One motion over every component the pose names.
 */
function playExit(
  view: ViewHandle<unknown>,
  state: MotionState,
  transition: MotionTransition
): Motion {
  const poses = posesOf(state);

  return view.all(poses.map(([component, fields]) => view.tween(component, fields, transition)));
}

/**
 * One change hook per named component: the view comes back to its rest pose over the transition.
 *
 * @param names - The component names `on.change` listed.
 * @param transition - How long the way home takes.
 * @returns The change table, keyed by component name.
 */
function changeHooks(names: readonly string[], transition: MotionTransition): ChangeHooks<unknown> {
  const hooks: Record<string, ChangeHook<unknown>> = {};

  for (const name of names) {
    const component = componentByName(name);

    if (component === undefined) continue;

    hooks[name] = (view: ViewHandle<unknown>): Motion => view.toRest(component, transition);
  }

  return hooks;
}

/**
 * Builds the projection motion hooks of an element from named poses. The transition is resolved
 * here, at definition time, so every track it starts carries a concrete duration.
 *
 * @param spec - The named poses, the transition and the hooks to build.
 * @returns The `enter`, `exit` and `change` hooks. `settle` is left out: the default of `world`
 *   applies.
 * @example
 * ```ts
 * const buttonMotion = defineMotion({
 *   states: { hidden: { Transform: { scale: 0.8 }, Shape: { alpha: 0 } } },
 *   transition: { ms: 150, ease: "out" },
 *   on: { enter: "hidden", exit: "hidden", change: ["Transform"] }
 * });
 * buttonMotion.settle; // undefined
 * ```
 */
export function defineMotion(spec: MotionSpec): ProjectionMotion<unknown> {
  const transition: MotionTransition = {
    ms: spec.transition?.ms ?? DEFAULT_TRANSITION_MS,
    ease: spec.transition?.ease ?? DEFAULT_TRANSITION_EASE
  };
  const enterState = stateOf(spec, spec.on.enter);
  const exitState = stateOf(spec, spec.on.exit);
  const changed = spec.on.change ?? [];

  return {
    ...(enterState === undefined
      ? {}
      : { enter: (view: ViewHandle<unknown>): Motion => playEnter(view, enterState, transition) }),
    ...(exitState === undefined
      ? {}
      : { exit: (view: ViewHandle<unknown>): Motion => playExit(view, exitState, transition) }),
    ...(changed.length === 0 ? {} : { change: changeHooks(changed, transition) })
  };
}
