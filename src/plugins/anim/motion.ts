/**
 * @file anim plugin — `defineMotion`: the sugar that turns named poses, keyframe tracks and a
 * loop into the three projection motion hooks of `world`. Pure, no ctx: it only builds hooks that
 * call `ViewHandle`, so a UI element and a projection view play the same way through the same
 * driver. The loop hook carries a fingerprint of its data, so `ui` can tell an equal loop built
 * again from a new one.
 */

import type { Hint } from "../flow/types";
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
  MotionCause,
  NumericFields,
  ProjectionMotion,
  ReducedMotion,
  ViewHandle
} from "../world/types";
import { asComponent } from "./components";
import { checkLoop, checkTrack, playKeyframes, playLoop, reducedOption } from "./keyframes";
import type { MotionKeyframe } from "./types";

/** What a motion transition runs for when the author named nothing else. */
const DEFAULT_TRANSITION_MS = 250;

/** What a motion transition eases with when the author named nothing else. */
const DEFAULT_TRANSITION_EASE: Ease = "out";

/** The key of the fingerprint `loopHook` stamps on the loop hook it builds. */
const PRINT: unique symbol = Symbol("moku.motion.print");

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
 * The resolved way between two poses: `defineMotion` fills every field in, so every track a hook
 * starts carries a concrete duration, curve and reduced-motion rule.
 *
 * @example
 * ```ts
 * const transition: MotionTransition = { ms: 150, ease: "out", reduced: "cut" };
 * ```
 */
export type MotionTransition = {
  readonly ms: number;
  readonly ease: Ease;
  readonly reduced: ReducedMotion;
};

/**
 * What `defineMotion` is given: the named poses, the keyframe tracks, how long the way takes, and
 * which hooks to build. `on.enter` and `on.exit` name a state or a track. For a track,
 * `transition.ms` is the whole walk and each segment eases by its key, not by `transition.ease`.
 *
 * `loop.track` names a keyframe track that plays from the moment the element enters, forever,
 * added over whatever else moves it: one cycle is `loop.ms` (default `transition.ms`), every
 * Transform key is an offset from rest, and the last key repeats the first one. It is not part of
 * the motion `enter` returns.
 *
 * `when` says when `enter` and `exit` play: `"always"` (the default) or only for a commit
 * (`"change"`). `transition.reduced` and `loop.reduced` say what reduced motion does to their
 * tracks: `"cut"` (the default) or `"keep"`.
 *
 * @example
 * ```ts
 * const spec: MotionSpec = {
 *   states: { hidden: { Transform: { scale: 0.8 } } },
 *   keyframes: { dropIn: [{ at: 0, Transform: { dy: -780, scale: 0.8 } }, { at: 0.42, Transform: { dy: 14 } }] },
 *   transition: { ms: 1000 },
 *   on: { enter: "dropIn", exit: "hidden", change: ["Transform"] }
 * };
 * // An order card pops in over 250 ms and sways on its pin, one swing every 2400 ms.
 * const orderCard: MotionSpec = {
 *   states: { small: { Transform: { scale: 0.8 } } },
 *   keyframes: { sway: [{ at: 0, Transform: { rotation: 0 } }, { at: 0.5, Transform: { rotation: 0.03 } }, { at: 1, Transform: { rotation: 0 } }] },
 *   transition: { ms: 250 },
 *   loop: { track: "sway", ms: 2400 },
 *   on: { enter: "small" }
 * };
 * // A card that stands at rest when its board mounts and fades in when a commit adds it, also
 * // under reduced motion.
 * const newCard: MotionSpec = {
 *   states: { faded: { Shape: { alpha: 0 } } },
 *   transition: { ms: 220, reduced: "keep" },
 *   on: { enter: "faded" },
 *   when: "change"
 * };
 * ```
 */
export type MotionSpec = {
  readonly states?: Readonly<Record<string, MotionState>>;
  readonly keyframes?: Readonly<Record<string, readonly MotionKeyframe[]>>;
  readonly transition?: {
    readonly ms?: number;
    readonly ease?: Ease;
    readonly reduced?: ReducedMotion;
  };
  readonly loop?: {
    readonly track: string;
    readonly ms?: number;
    readonly reduced?: ReducedMotion;
  };
  readonly on: {
    readonly enter?: string;
    readonly exit?: string;
    readonly change?: readonly (keyof MotionComponents & string)[];
  };
  /**
   * When `enter` and `exit` play: `"always"` (the default, as before) or only for a commit
   * (`"change"`); with `"change"` an element that comes or goes with its screen stands at rest and
   * leaves without a motion. The loop is not concerned.
   */
  readonly when?: "always" | "change";
};

/**
 * The enter or exit hook `defineMotion` builds: it is told why it plays, and plays for no reason
 * the motion does not accept.
 */
type MotionHook = (
  view: ViewHandle<unknown>,
  item?: unknown,
  hint?: Hint,
  cause?: MotionCause
) => Motion;

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
 * The resolved loop of a motion: the keys of its track, the length of one cycle and what reduced
 * motion does to it.
 */
type MotionLoop = {
  readonly keys: readonly MotionKeyframe[];
  readonly ms: number;
  readonly reduced: ReducedMotion;
};

/**
 * Resolves the loop a motion names, if it names one.
 *
 * @param spec - What `defineMotion` was given.
 * @param transitionMs - The resolved `transition.ms`, one cycle when `loop.ms` is left out.
 * @returns The keys and the cycle length, or `undefined` when the motion has no loop.
 * @throws {Error} When `loop.track` names no keyframe track, `loop.ms` is not a finite number
 *   above 0, or the track does not close on itself.
 */
function loopOf(spec: MotionSpec, transitionMs: number): MotionLoop | undefined {
  if (spec.loop === undefined) return undefined;

  const { track, ms = transitionMs } = spec.loop;
  const keys = ownEntry(spec.keyframes, track);

  if (keys === undefined) {
    throw new Error(
      `[game] Motion names "${track}" in loop, but no keyframe track has it.\n  Define it in keyframes.`
    );
  }

  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(
      `[game] Motion loop "${track}" has ms ${ms}.\n  Give one cycle a finite length above 0.`
    );
  }

  checkLoop(track, keys);

  return { keys, ms, reduced: spec.loop.reduced ?? "cut" };
}

/**
 * Checks the fields of a motion that take one of a few words: `when`, and `reduced` of the
 * transition and of the loop. A plain JavaScript caller can pass any value.
 *
 * @param spec - What `defineMotion` was given.
 * @throws {Error} With the value at fault, in the house format.
 */
function checkChoices(spec: MotionSpec): void {
  const when: unknown = spec.when;

  if (when !== undefined && when !== "always" && when !== "change") {
    throw new Error(`[game] Motion has when "${String(when)}".\n  Use "always" or "change".`);
  }

  const rules: unknown[] = [spec.transition?.reduced, spec.loop?.reduced];

  for (const reduced of rules) {
    if (reduced === undefined || reduced === "cut" || reduced === "keep") continue;

    throw new Error(`[game] Motion has reduced "${String(reduced)}".\n  Use "cut" or "keep".`);
  }
}

/**
 * Checks a motion at definition time: every keyframe track, no name that is both a state and a
 * track, an `on.enter` / `on.exit` that names one of them, and the words of `when` and `reduced`.
 *
 * @param spec - What `defineMotion` was given.
 * @throws {Error} With the name or the value at fault, in the house format.
 */
function checkMotion(spec: MotionSpec): void {
  checkChoices(spec);

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
 * What plays the name `on` gave a hook: a state is reached with tweens, a keyframe track is walked.
 *
 * @param spec - What `defineMotion` was given, already checked.
 * @param hook - Which hook to build.
 * @param transition - The resolved transition.
 * @returns The player, or `undefined` when `on` names nothing for it.
 */
function playerOf(
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

  return keys === undefined
    ? undefined
    : view => playKeyframes(view, keys, transition.ms, hook, transition.reduced);
}

/**
 * Builds the enter or exit hook for the name `on` gave it. A motion that plays only for changes
 * plays nothing for a cause `"mount"`: the view is not touched, so it stands at rest. A call
 * without a cause plays.
 *
 * @param spec - What `defineMotion` was given, already checked.
 * @param hook - Which hook to build.
 * @param transition - The resolved transition.
 * @param when - When the hook plays.
 * @returns The hook, or `undefined` when `on` names nothing for it.
 */
function hookOf(
  spec: MotionSpec,
  hook: "enter" | "exit",
  transition: MotionTransition,
  when: "always" | "change"
): MotionHook | undefined {
  const play = playerOf(spec, hook, transition);

  if (play === undefined) return undefined;

  return (view, _item, _hint, cause) =>
    when === "change" && cause === "mount" ? undefined : play(view);
}

/**
 * Writes a value as JSON with the keys of every plain object sorted and its `undefined` fields
 * left out, so two equal values built apart give the same text.
 *
 * @param value - The value to write.
 * @returns The text, or `undefined` when the value holds a function anywhere.
 * @example
 * ```ts
 * stableJson({ b: 1, a: [2] }); // '{"a":[2],"b":1}'
 * ```
 */
function stableJson(value: unknown): string | undefined {
  if (typeof value === "function") return undefined;
  if (Array.isArray(value)) return listJson(value);
  if (typeof value === "object" && value !== null) return recordJson(value);

  return JSON.stringify(value);
}

/**
 * Writes a list for `stableJson`, in order.
 *
 * @param list - The list to write.
 * @returns The text, or `undefined` when an entry holds a function.
 * @example
 * ```ts
 * listJson([{ b: 1, a: 2 }]); // '[{"a":2,"b":1}]'
 * ```
 */
function listJson(list: readonly unknown[]): string | undefined {
  const parts: string[] = [];

  for (const entry of list) {
    const part = entry === undefined ? "null" : stableJson(entry);

    if (part === undefined) return undefined;
    parts.push(part);
  }

  return `[${parts.join(",")}]`;
}

/**
 * Writes a plain object for `stableJson`, its keys sorted and its `undefined` fields left out.
 *
 * @param record - The object to write.
 * @returns The text, or `undefined` when a field holds a function.
 * @example
 * ```ts
 * recordJson({ z: undefined, y: "a" }); // '{"y":"a"}'
 * ```
 */
function recordJson(record: object): string | undefined {
  const parts: string[] = [];
  const fields = record as Readonly<Record<string, unknown>>;

  for (const key of Object.keys(fields).toSorted()) {
    if (fields[key] === undefined) continue;

    const part = stableJson(fields[key]);

    if (part === undefined) return undefined;
    parts.push(`${JSON.stringify(key)}:${part}`);
  }

  return `{${parts.join(",")}}`;
}

/**
 * The loop hook: it starts the loop on a view and answers its motion, which never ends on its own.
 * The hook carries the fingerprint of its keys, cycle and reduced-motion rule, under a symbol, so
 * `printOf` reads it; a loop whose keys hold a function ease carries none.
 *
 * @param loop - The resolved loop, if any.
 * @returns The hook, or `undefined` when the motion names no loop.
 */
function loopHook(
  loop: MotionLoop | undefined
): ((view: ViewHandle<unknown>) => Motion) | undefined {
  if (loop === undefined) return undefined;

  const hook = (view: ViewHandle<unknown>): Motion =>
    playLoop(view, loop.keys, loop.ms, loop.reduced);
  const print = stableJson({ keys: loop.keys, ms: loop.ms, reduced: loop.reduced });

  if (print !== undefined) Object.defineProperty(hook, PRINT, { value: print });

  return hook;
}

/**
 * The fingerprint `defineMotion` stamped on a loop hook: equal for two motions whose loop plays the same keys over the
 * same length with the same reduced-motion rule, absent on a hand-written hook and on a loop whose keys hold a
 * function ease.
 *
 * @param hook - A `loop` hook, or anything else.
 * @returns The fingerprint, or `undefined`.
 * @example
 * ```ts
 * const keys = [{ at: 0, Transform: { rotation: 0 } }, { at: 0.5, Transform: { rotation: 0.05 } }, { at: 1, Transform: { rotation: 0 } }];
 * const spec = { keyframes: { sway: keys }, loop: { track: "sway", ms: 1200 }, on: {} };
 * printOf(defineMotion(spec).loop) === printOf(defineMotion(spec).loop); // true
 * printOf(() => undefined); // undefined
 * ```
 */
export function printOf(hook: unknown): string | undefined {
  if (typeof hook !== "function") return undefined;

  const print: unknown = Reflect.get(hook, PRINT);

  return typeof print === "string" ? print : undefined;
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

  return view.all(poses.map(([component]) => view.toRest(component, trackOptionsOf(transition))));
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

  return view.all(
    poses.map(([component, fields]) => view.tween(component, fields, trackOptionsOf(transition)))
  );
}

/**
 * The options a transition starts a track with: its length and curve, and `reduced` only for a
 * kept track, so a cut track starts with the options it always had.
 *
 * @param transition - The resolved transition.
 * @returns The track options.
 * @example
 * ```ts
 * trackOptionsOf({ ms: 150, ease: "out", reduced: "cut" }); // { ms: 150, ease: "out" }
 * ```
 */
function trackOptionsOf(transition: MotionTransition): {
  ms: number;
  ease: Ease;
  reduced?: ReducedMotion;
} {
  return { ms: transition.ms, ease: transition.ease, ...reducedOption(transition.reduced) };
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

    hooks[name] = (view: ViewHandle<unknown>): Motion =>
      view.toRest(component, trackOptionsOf(transition));
  }

  return hooks;
}

/**
 * Builds the projection motion hooks of an element from named poses and keyframe tracks. The
 * transition is resolved and every name is checked here, at definition time, so every track it
 * starts carries a concrete duration and a wrong name fails where it is written. A `loop` builds
 * the `loop` hook: `world` and `ui` play it wherever they play `enter`, so a projection view loops
 * from its enter, or from the first live frame after a direct reconcile, and `ui` swaps it when
 * the motion prop of an element changes. One cycle of the loop is `loop.ms`, or `transition.ms`
 * when it is left out. With `when: "change"` the enter and exit play only for a commit: an element
 * that comes or goes with its screen stands at rest and leaves without a motion.
 *
 * @param spec - The named poses, the keyframe tracks, the transition, the loop and the hooks to
 *   build.
 * @returns The `enter`, `loop`, `exit` and `change` hooks. `settle` is left out: the default of
 *   `world` applies.
 * @throws {Error} When a track is invalid, a name is both a state and a track, `on` names
 *   neither, `loop.track` names no track, `loop.ms` is not a finite number above 0, the loop
 *   ends somewhere else than it starts, or `when` or a `reduced` is not one of its words.
 * @example
 * ```ts
 * const buttonMotion = defineMotion({
 *   states: { hidden: { Transform: { scale: 0.8 }, Shape: { alpha: 0 } } },
 *   transition: { ms: 150, ease: "out" },
 *   on: { enter: "hidden", exit: "hidden", change: ["Transform"] }
 * });
 * buttonMotion.settle; // undefined
 *
 * const cardMotion = defineMotion({
 *   states: { small: { Transform: { scale: 0.8 }, Shape: { alpha: 0 } } },
 *   transition: { ms: 220, ease: "out" },
 *   on: { enter: "small", exit: "small" },
 *   when: "change"
 * });
 * // a scene mount shows it at rest; a commit that adds it grows it in over 220 ms
 * ```
 */
export function defineMotion(spec: MotionSpec): ProjectionMotion<unknown> {
  checkMotion(spec);

  const transition: MotionTransition = {
    ms: spec.transition?.ms ?? DEFAULT_TRANSITION_MS,
    ease: spec.transition?.ease ?? DEFAULT_TRANSITION_EASE,
    reduced: spec.transition?.reduced ?? "cut"
  };
  const when = spec.when ?? "always";
  const enter = hookOf(spec, "enter", transition, when);
  const loop = loopHook(loopOf(spec, transition.ms));
  const exit = hookOf(spec, "exit", transition, when);
  const changed = spec.on.change ?? [];

  return {
    ...(enter === undefined ? {} : { enter }),
    ...(loop === undefined ? {} : { loop }),
    ...(exit === undefined ? {} : { exit }),
    ...(changed.length === 0 ? {} : { change: changeHooks(changed, transition) })
  };
}
