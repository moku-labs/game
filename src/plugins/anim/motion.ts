/**
 * @file anim plugin — `defineMotion`: the sugar that turns named poses and keyframe tracks into
 * the three projection motion hooks of `world`. Pure, no ctx: it only builds hooks that call
 * `ViewHandle`, so a UI element and a projection view play the same way through the same driver.
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
import { checkTrack, playKeyframes } from "./keyframes";
import type { MotionKeyframe } from "./types";

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
 * What `defineMotion` is given: the named poses, the keyframe tracks, how long the way takes, and
 * which hooks to build. `on.enter` and `on.exit` name a state or a track. For a track,
 * `transition.ms` is the whole walk and each segment eases by its key, not by `transition.ease`.
 *
 * @example
 * ```ts
 * const spec: MotionSpec = {
 *   states: { hidden: { Transform: { scale: 0.8 } } },
 *   keyframes: { dropIn: [{ at: 0, Transform: { dy: -780, scale: 0.8 } }, { at: 0.42, Transform: { dy: 14 } }] },
 *   transition: { ms: 1000 },
 *   on: { enter: "dropIn", exit: "hidden", change: ["Transform"] }
 * };
 * ```
 */
export type MotionSpec = {
  readonly states?: Readonly<Record<string, MotionState>>;
  readonly keyframes?: Readonly<Record<string, readonly MotionKeyframe[]>>;
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
 * Reads one own entry of a record, so a name such as `"toString"` never reaches the prototype.
 *
 * @param record - The states or the keyframe tracks, if any.
 * @param name - The name to look up.
 * @returns The entry, or `undefined` when the record has no own entry of that name.
 * @example
 * ```ts
 * ownEntry({ hidden: {} }, "hidden"); // {}
 * ownEntry({ hidden: {} }, "toString"); // undefined
 * ```
 */
function ownEntry<Value>(
  record: Readonly<Record<string, Value>> | undefined,
  name: string
): Value | undefined {
  return record !== undefined && Object.hasOwn(record, name) ? record[name] : undefined;
}

/**
 * Checks a motion at definition time: every keyframe track, no name that is both a state and a
 * track, and an `on.enter` / `on.exit` that names one of them.
 *
 * @param spec - What `defineMotion` was given.
 * @throws {Error} With the name at fault, in the house format.
 */
function checkMotion(spec: MotionSpec): void {
  for (const [name, keys] of Object.entries(spec.keyframes ?? {})) {
    checkTrack(name, keys);

    if (ownEntry(spec.states, name) !== undefined) {
      throw new Error(
        `[game] Motion "${name}" is both a state and a keyframe track.\n  Give one of them another name.`
      );
    }
  }

  for (const hook of ["enter", "exit"] as const) {
    const name = spec.on[hook];

    if (name === undefined) continue;
    if (ownEntry(spec.states, name) !== undefined) continue;
    if (ownEntry(spec.keyframes, name) !== undefined) continue;

    throw new Error(
      `[game] Motion names "${name}" in on.${hook}, but no state or track has it.\n  Define it in states or keyframes.`
    );
  }
}

/**
 * Builds the enter or exit hook for the name `on` gave it: a state is reached with tweens, a
 * keyframe track is walked.
 *
 * @param spec - What `defineMotion` was given, already checked.
 * @param hook - Which hook to build.
 * @param transition - The resolved transition.
 * @returns The hook, or `undefined` when `on` names nothing for it.
 */
function hookOf(
  spec: MotionSpec,
  hook: "enter" | "exit",
  transition: MotionTransition
): ((view: ViewHandle<unknown>) => Motion) | undefined {
  const name = spec.on[hook];

  if (name === undefined) return undefined;

  const state = ownEntry(spec.states, name);

  if (state !== undefined) {
    return hook === "enter"
      ? view => playEnter(view, state, transition)
      : view => playExit(view, state, transition);
  }

  const keys = ownEntry(spec.keyframes, name);

  return keys === undefined ? undefined : view => playKeyframes(view, keys, transition.ms, hook);
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
 * Builds the projection motion hooks of an element from named poses and keyframe tracks. The
 * transition is resolved and every name is checked here, at definition time, so every track it
 * starts carries a concrete duration and a wrong name fails where it is written.
 *
 * @param spec - The named poses, the keyframe tracks, the transition and the hooks to build.
 * @returns The `enter`, `exit` and `change` hooks. `settle` is left out: the default of `world`
 *   applies.
 * @throws {Error} When a track is invalid, a name is both a state and a track, or `on` names
 *   neither.
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
  checkMotion(spec);

  const transition: MotionTransition = {
    ms: spec.transition?.ms ?? DEFAULT_TRANSITION_MS,
    ease: spec.transition?.ease ?? DEFAULT_TRANSITION_EASE
  };
  const enter = hookOf(spec, "enter", transition);
  const exit = hookOf(spec, "exit", transition);
  const changed = spec.on.change ?? [];

  return {
    ...(enter === undefined ? {} : { enter }),
    ...(exit === undefined ? {} : { exit }),
    ...(changed.length === 0 ? {} : { change: changeHooks(changed, transition) })
  };
}
