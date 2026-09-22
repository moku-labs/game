/**
 * @file anim/timeline — the authoring helpers of a choreography. Pure: they produce frozen plain
 * data with no callback inside, so a step tree can be read, logged and compared. `defineAnimation`
 * only wraps the slots and the build function; `build` itself runs once per play.
 */
import type { Json } from "../../model/types";
import type { AnyComponentValue } from "../../world/ecs/types";
import type { ComponentType, Ease, NumericFields } from "../../world/types";
import { asComponent } from "../components";
import type {
  AnimationDefinition,
  AnimationSpec,
  BuildTools,
  Pose,
  SlotTags,
  SlotValues,
  Target
} from "../types";
import type {
  ExternalPlayer,
  FxStep,
  HapticDescriptor,
  PlayDescriptor,
  SfxDescriptor,
  Step
} from "./types";

/** What a `tween` step runs on when the author named nothing else. */
export const DEFAULT_EASE: Ease = "out";

/** The bus a sound plays on when the author named nothing else. */
const DEFAULT_BUS = "sfx";

/** The layer a spawned entity is drawn in when the author named nothing else. */
const DEFAULT_SPAWN_LAYER = "ui";

/** The pose `at` answers with for a target nothing resolves. */
const IDENTITY_POSE: Pose = Object.freeze({ x: 0, y: 0, rotation: 0, scale: 1 });

/**
 * The build tools a nested `use` gets when the caller passed none: `at` answers the identity
 * pose, because a pure builder outside a play has nothing to read a rest pose from.
 *
 * @returns Tools whose `at` is the identity pose.
 */
function identityTools(): BuildTools {
  return { at: (): Pose => IDENTITY_POSE };
}

/**
 * Keeps the numeric fields of a tween target. A non-numeric field cannot be interpolated, and
 * the type of `tween` already refuses one.
 *
 * @param to - What the author asked for.
 * @returns The numeric fields.
 * @example
 * ```ts
 * numbersOf({ x: 10, texture: "a" }); // { x: 10 }
 * ```
 */
function numbersOf(to: object): Record<string, number> {
  const numeric: Record<string, number> = {};

  for (const [field, value] of Object.entries(to)) {
    if (typeof value === "number") numeric[field] = value;
  }

  return numeric;
}

/**
 * Turns one target into JSON, so a `play` descriptor survives the effects gateway.
 *
 * @param target - The entity, the projection key or the spawned id.
 * @returns The same target as JSON.
 * @example
 * ```ts
 * targetJson({ projection: "hud", key: "coins" }); // { projection: "hud", key: "coins" }
 * ```
 */
function targetJson(target: Target): Json {
  if (typeof target === "number") return target;

  if ("spawned" in target) return { spawned: target.spawned };

  return { projection: target.projection, key: target.key };
}

/**
 * Copies one component value into frozen plain data, so the step never shares an object the
 * author may still change.
 *
 * @param entry - The component value, as `Transform({ x: 40 })` built it.
 * @returns A frozen copy with a frozen value.
 */
function frozenComponent(entry: AnyComponentValue): AnyComponentValue {
  const value = entry.value === true ? true : Object.freeze({ ...entry.value });

  return Object.freeze({ type: entry.type, value });
}

/**
 * Turns the slots of a play into JSON.
 *
 * @param slots - One target, or a list of targets, per slot.
 * @returns The slots as JSON.
 */
function slotsJson(slots: object): Json {
  const json: Record<string, Json> = {};

  for (const [name, value] of Object.entries(slots)) {
    json[name] = Array.isArray(value)
      ? value.map(entry => targetJson(entry as Target))
      : targetJson(value as Target);
  }

  return json;
}

/**
 * Runs the steps one after another. The remainder past a step's end reaches the next step in the
 * same frame, so the tree takes exactly the sum of its durations.
 *
 * @param steps - The steps, in order.
 * @returns The sequence step.
 * @example
 * ```ts
 * sequence(wait(100), mark("done"));
 * // { kind: "sequence", steps: [{ kind: "wait", ms: 100 }, { kind: "mark", name: "done" }] }
 * ```
 */
export function sequence(...steps: readonly Step[]): Step {
  return Object.freeze({ kind: "sequence" as const, steps: Object.freeze([...steps]) });
}

/**
 * Runs every step at once and ends with the longest one.
 *
 * @param steps - The steps.
 * @returns The parallel step.
 * @example
 * ```ts
 * parallel(wait(100), wait(300)); // ends after 300 ms
 * ```
 */
export function parallel(...steps: readonly Step[]): Step {
  return Object.freeze({ kind: "parallel" as const, steps: Object.freeze([...steps]) });
}

/**
 * Builds one step per item and starts each one `staggerMs` later than the one before. The build
 * function runs here, so no function survives in the data.
 *
 * @param items - What to build a step for.
 * @param staggerMs - Delay between two neighbouring items, in game milliseconds.
 * @param build - Builds the step of one item.
 * @returns The parallel of delayed sequences.
 * @example
 * ```ts
 * stagger(["a", "b"], 60, item => mark(item));
 * // parallel(sequence(wait(0), mark("a")), sequence(wait(60), mark("b")))
 * ```
 */
export function stagger<Item>(
  items: readonly Item[],
  staggerMs: number,
  build: (item: Item, index: number) => Step
): Step {
  return parallel(
    ...items.map((item, index) => sequence(wait(index * staggerMs), build(item, index)))
  );
}

/**
 * Holds still for a while.
 *
 * @param durationMs - How long to wait, in game milliseconds.
 * @returns The wait step.
 * @example
 * ```ts
 * wait(120); // { kind: "wait", ms: 120 }
 * ```
 */
export function wait(durationMs: number): Step {
  return Object.freeze({ kind: "wait" as const, ms: durationMs });
}

/**
 * Names a point in the choreography. Reaching it emits `anim:mark`, calls the `onMark` listeners
 * and appends the name to `marks()`. It is the only way out of a timeline.
 *
 * @param name - Name of the mark.
 * @returns The mark step.
 * @example
 * ```ts
 * mark("landed"); // { kind: "mark", name: "landed" }
 * ```
 */
export function mark(name: string): Step {
  return Object.freeze({ kind: "mark" as const, name });
}

/**
 * Moves the numeric fields of one component of one target to an exact target value.
 *
 * @param target - The projection key or the entity to animate.
 * @param component - The component to animate.
 * @param to - The numeric target fields.
 * @param options - Duration, easing, delay and the additive flag.
 * @param options.ms - Duration in game milliseconds.
 * @param options.ease - Easing curve; `"out"` when omitted.
 * @param options.delayMs - How long the track waits before it reads its start values.
 * @param options.additive - `true` adds an offset instead of owning the fields.
 * @returns The tween step.
 * @example
 * ```ts
 * tween({ projection: "hud", key: "coins" }, Transform, { scale: 1.2 }, { ms: 120 });
 * // { kind: "tween", ms: 120, ease: "out", delayMs: 0, additive: false, ... }
 * ```
 */
export function tween<Value extends object>(
  target: Target,
  component: ComponentType<Value>,
  to: Partial<NumericFields<Value>>,
  options: { ms: number; ease?: Ease; delayMs?: number; additive?: boolean }
): Step {
  return Object.freeze({
    kind: "tween" as const,
    target,
    component: asComponent(component),
    to: Object.freeze(numbersOf(to)),
    ms: options.ms,
    ease: options.ease ?? DEFAULT_EASE,
    delayMs: options.delayMs ?? 0,
    additive: options.additive === true
  });
}

/**
 * Writes a component patch at once. Any field may be written, not only the numeric ones.
 *
 * @param target - The projection key or the entity to write.
 * @param component - The component to write.
 * @param patch - The fields to overwrite.
 * @returns The set step.
 * @example
 * ```ts
 * set({ projection: "hud", key: "coins" }, Sprite, { texture: "hud.coin-gold" });
 * // { kind: "set", patch: { texture: "hud.coin-gold" }, ... }
 * ```
 */
export function set<Value extends object>(
  target: Target,
  component: ComponentType<Value>,
  patch: Partial<Value>
): Step {
  return Object.freeze({
    kind: "set" as const,
    target,
    component: asComponent(component),
    patch: Object.freeze({ ...patch })
  });
}

/**
 * Plays a frame sprite: one texture key of the list per frame of `fps`, written into `Sprite`.
 *
 * @param target - The projection key or the entity to animate.
 * @param options - The keys, the frame rate and whether the list repeats.
 * @param options.keys - The texture keys, in play order.
 * @param options.fps - Frames per second of the list.
 * @param options.loop - `true` repeats the list until the step is finished.
 * @returns The frames step.
 * @example
 * ```ts
 * frames({ projection: "board", key: "c3" }, { keys: ["fx.pop-1", "fx.pop-2"], fps: 12 });
 * // { kind: "frames", keys: ["fx.pop-1", "fx.pop-2"], fps: 12, loop: false, ... }
 * ```
 */
export function frames(
  target: Target,
  options: { keys: readonly string[]; fps: number; loop?: boolean }
): Step {
  return Object.freeze({
    kind: "frames" as const,
    target,
    keys: Object.freeze([...options.keys]),
    fps: options.fps,
    loop: options.loop === true
  });
}

/**
 * Makes a temporary entity when the step is reached: a flying coin, a toast sign, a sparkle. The
 * entity is owned by `anim`, drawn in `layer` at `order`, and despawned when the timeline ends, is
 * finished or is cancelled. Later steps of the same timeline aim at it with `spawned(id)`.
 *
 * @param id - Name of the entity inside this timeline; one timeline spawns each id once.
 * @param components - The component values the entity starts with, as `world.ecs.spawn` takes.
 * @param options - Where the entity is drawn.
 * @param options.layer - The layer; `"ui"` when omitted.
 * @param options.order - The draw order inside the layer; `0` when omitted.
 * @returns The spawn step.
 * @example
 * ```ts
 * spawn("coin1", [Sprite({ texture: "ui.icon-coin" }), Transform({ x: 540, y: 900 })], { order: 50 });
 * // { kind: "spawn", id: "coin1", components: [...], layer: "ui", order: 50 }
 * ```
 */
export function spawn(
  id: string,
  components: readonly AnyComponentValue[],
  options?: { layer?: string; order?: number }
): Step {
  return Object.freeze({
    kind: "spawn" as const,
    id,
    components: Object.freeze(components.map(entry => frozenComponent(entry))),
    layer: options?.layer ?? DEFAULT_SPAWN_LAYER,
    order: options?.order ?? 0
  });
}

/**
 * Aims a later step at the entity a `spawn` step of the same timeline made. Before that step is
 * reached nothing answers the id, so a step aimed at it ends silently.
 *
 * @param id - The id the `spawn` step was given.
 * @returns The target.
 * @example
 * ```ts
 * tween(spawned("coin1"), Transform, { x: 40, y: 120 }, { ms: 600, ease: "inCubic" });
 * // { kind: "tween", target: { spawned: "coin1" }, ... }
 * ```
 */
export function spawned(id: string): { spawned: string } {
  return Object.freeze({ spawned: id });
}

/**
 * A sound. `anim` owns the descriptor because it sits below `audio`; `audio` owns the handler,
 * and a game without `audio` plays nothing and hears no error.
 *
 * @param key - Asset key of the sound.
 * @param options - The bus to play it on.
 * @param options.bus - `"sfx"` when omitted.
 * @returns The descriptor, usable as a timeline step and as `fx(...)` in a node.
 * @example
 * ```ts
 * sfx("board.merge"); // { kind: "sfx", payload: { key: "board.merge", bus: "sfx" }, cosmetic: true }
 * ```
 */
export function sfx(key: string, options?: { bus?: string }): SfxDescriptor {
  return Object.freeze({
    kind: "sfx" as const,
    payload: Object.freeze({ key, bus: options?.bus ?? DEFAULT_BUS }),
    cosmetic: true as const
  });
}

/**
 * A haptic tick. `platform` owns the handler; a device without one stays still.
 *
 * @param kind - Which tick to play, for example `"light"`.
 * @returns The descriptor, usable as a timeline step and as `fx(...)` in a node.
 * @example
 * ```ts
 * haptic("light"); // { kind: "haptic", payload: { kind: "light" }, cosmetic: true }
 * ```
 */
export function haptic(kind: string): HapticDescriptor {
  return Object.freeze({
    kind: "haptic" as const,
    payload: Object.freeze({ kind }),
    cosmetic: true as const
  });
}

/**
 * Reserved for Spine and the other external players. It throws until one arrives, so nobody
 * builds a choreography on a door that is not open yet.
 *
 * @param _player - The player that would run the clip.
 * @param _clip - Name of the clip.
 * @throws {Error} Always.
 * @example
 * ```ts
 * external(spine, "idle"); // throws: External players arrive with Spine.
 * ```
 */
export function external(_player: ExternalPlayer, _clip: string): never {
  throw new Error("[game] External players arrive with Spine.\n  Use tween or frames.");
}

/**
 * Nests one animation inside another. The nested tree is built here, so its marks are reported
 * under the nested id and no function survives in the data. Pass the outer `tools` when the
 * nested `build` reads `at`.
 *
 * @param animation - The animation to nest.
 * @param slots - One target, or a list of targets, per slot of the nested animation.
 * @param tools - The build tools of the outer animation; without them `at` is the identity pose.
 * @returns The use step.
 * @example
 * ```ts
 * use(popCard, { card: { projection: "hud", key: "order" } });
 * // { kind: "use", id: "hud.popCard", step: { kind: "sequence", ... } }
 * ```
 */
export function use<Tags extends SlotTags>(
  animation: AnimationDefinition<Tags>,
  slots: SlotValues<Tags>,
  tools?: BuildTools
): Step {
  return Object.freeze({
    kind: "use" as const,
    id: animation.id,
    step: animation.build(slots, tools ?? identityTools())
  });
}

/**
 * The effect descriptor a node awaits to play a choreography. The payload names the animation,
 * so the handler resolves the definition from the registry the features filled.
 *
 * @param animation - The animation to play.
 * @param slots - One target, or a list of targets, per slot.
 * @returns The descriptor, cosmetic, so a failing build never breaks the node.
 * @example
 * ```ts
 * play(coinsFly, { from: { projection: "hud", key: "purse" } });
 * // { kind: "play", payload: { animation: "hud.coinsFly", slots: { from: { ... } } }, cosmetic: true }
 * ```
 */
export function play<Tags extends SlotTags>(
  animation: AnimationDefinition<Tags>,
  slots: SlotValues<Tags>
): PlayDescriptor {
  return Object.freeze({
    kind: "play" as const,
    payload: Object.freeze({ animation: animation.id, slots: slotsJson(slots) }),
    cosmetic: true as const
  });
}

/**
 * Declares one animation: an id, the slots it takes and the pure function that builds its step
 * tree. `build` runs once per play, so the same animation may play twice at once.
 *
 * @param id - Animation id, unique across the features of a game.
 * @param spec - The slots and the build function.
 * @returns The animation as frozen plain data.
 * @example
 * ```ts
 * const coinsFly = defineAnimation("hud.coinsFly", {
 *   slots: { from: type<Target>() },
 *   build: ({ from }) => tween(from, Transform, { scale: 0.4 }, { ms: 600 })
 * });
 * coinsFly.id; // "hud.coinsFly"
 * ```
 */
export function defineAnimation<Tags extends SlotTags>(
  id: string,
  spec: AnimationSpec<Tags>
): AnimationDefinition<Tags> {
  return Object.freeze({ id, slots: spec.slots, build: spec.build });
}

/**
 * Tells whether a step is one of the two descriptors `anim` owns.
 *
 * @param step - The step that was reached.
 * @returns True for an `sfx` or a `haptic` step.
 * @example
 * ```ts
 * isFxStep(haptic("light")); // true
 * isFxStep(wait(10)); // false
 * ```
 */
export function isFxStep(step: Step): step is FxStep {
  return step.kind === "sfx" || step.kind === "haptic";
}
