/**
 * @file anim plugin — shared types: the public API a game reads, the authoring data of a
 * choreography, the plugin state and the kernel slice the domain files run on.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as FlowApi, TypeTag } from "../flow/types";
import type { Api as TimeApi } from "../time/types";
import type { Ease, Entity, MotionHandle, Api as WorldApi } from "../world/types";
import type { RunningTimeline, Step } from "./timeline/types";
import type { Track } from "./tween/types";

/**
 * What a step and a slot are pointed at: the projection key of a live view or of an element a
 * plugin above registered with `registerKey`, an entity, or the id of an entity a `spawn` step of
 * the same timeline made (`spawned(id)`). A node passes keys, never entities.
 *
 * @example
 * ```ts
 * const counter: Target = { projection: "hud", key: "coins" };
 * const flyingCoin: Target = spawned("coin1"); // { spawned: "coin1" }
 * ```
 */
export type Target = { projection: string; key: string } | Entity | { spawned: string };

/**
 * The pose `at(target)` answers with: where the target rests in root (reference) space, its rest
 * `Transform` composed through the `Parent` chain, or the identity pose when nothing is there.
 *
 * @example
 * ```ts
 * const pose: Pose = { x: 540, y: 960, rotation: 0, scale: 1 };
 * ```
 */
export type Pose = { x: number; y: number; rotation: number; scale: number };

/**
 * The slot declaration of an animation: one type tag per slot, each carrying one target or a
 * list of targets.
 *
 * @example
 * ```ts
 * const slots: SlotTags = { items: type<Target[]>(), card: type<Target>() };
 * ```
 */
export type SlotTags = Readonly<Record<string, TypeTag<Target> | TypeTag<Target[]>>>;

/**
 * The targets `play` and `use` take, read off the slot tags of the animation.
 *
 * @example
 * ```ts
 * type Slots = SlotValues<{ card: TypeTag<Target> }>; // { card: Target }
 * ```
 */
export type SlotValues<Tags extends SlotTags> = { [Name in keyof Tags]: SlotValue<Tags[Name]> };

/**
 * What one slot tag stands for: a list of targets when the tag declared one, a single target
 * otherwise. Distributive on purpose, so the erased `SlotTags` widens to both.
 *
 * @example
 * ```ts
 * type One = SlotValue<TypeTag<Target>>; // Target
 * ```
 */
export type SlotValue<Tag> = Tag extends TypeTag<Target[]> ? Target[] : Target;

/**
 * The slots of a running animation with their tags erased, as `build` and the `play` handler
 * read them.
 *
 * @example
 * ```ts
 * const slots: SlotRecord = { card: { projection: "hud", key: "order" } };
 * ```
 */
export type SlotRecord = SlotValues<SlotTags>;

/**
 * What `build` is handed next to the slots: `at` reads where a target rests at play time, in root
 * space (its rest `Transform` composed through the `Parent` chain, every pivot applied), so a
 * choreography can fly one element to where another one rests, even inside a scaled slot. A view
 * that has a `Parent` itself is aimed at that pose with a `tween` in `space: "root"`.
 *
 * @example
 * ```ts
 * const tools: BuildTools = { at: () => ({ x: 0, y: 0, rotation: 0, scale: 1 }) };
 * ```
 */
export type BuildTools = { at(target: Target): Pose };

/**
 * One animation: an id, the slots it takes and the pure function that builds its step tree. The
 * same definition may play twice at once, because `build` runs per play.
 *
 * @example
 * ```ts
 * const coinsFly: AnimationDefinition<{ from: TypeTag<Target> }> = defineAnimation("hud.coinsFly", {
 *   slots: { from: type<Target>() },
 *   build: ({ from }) => tween(from, Transform, { scale: 0.4 }, { ms: 600 })
 * });
 * coinsFly.id; // "hud.coinsFly"
 * ```
 */
export type AnimationDefinition<Tags extends SlotTags = SlotTags> = {
  readonly id: string;
  readonly slots: Tags;
  build(slots: SlotValues<Tags>, tools: BuildTools): Step;
};

/**
 * What `defineAnimation` is given: the slots the animation takes and the pure function that
 * builds its step tree.
 *
 * @example
 * ```ts
 * const spec: AnimationSpec<{ card: TypeTag<Target> }> = {
 *   slots: { card: type<Target>() },
 *   build: ({ card }) => tween(card, Transform, { scale: 1.2 }, { ms: 120 })
 * };
 * ```
 */
export type AnimationSpec<Tags extends SlotTags> = {
  readonly slots: Tags;
  build(slots: SlotValues<Tags>, tools: BuildTools): Step;
};

/**
 * An animation with its slot tags erased, as the registry stores it.
 *
 * @example
 * ```ts
 * const stored: AnyAnimationDefinition = { id: "hud.coinsFly", slots: {}, build: () => wait(0) };
 * ```
 */
export type AnyAnimationDefinition = AnimationDefinition<SlotTags>;

/**
 * What `play` hands back: the motion contract over the whole step tree, the promise of its end
 * and the marks it reached so far.
 *
 * @example
 * ```ts
 * const handle: PlayHandle = app.anim.play(coinsFly, { from: { projection: "hud", key: "coins" } });
 * handle.marks(); // []: nothing reached yet
 * ```
 */
export type PlayHandle = MotionHandle & {
  readonly done: Promise<void>;
  marks(): readonly string[];
};

/**
 * A listener of `onMark`: the animation id and the name of the mark that was reached.
 *
 * @example
 * ```ts
 * const reached: string[] = [];
 * const listener: MarkListener = (_animation, mark) => reached.push(mark);
 * ```
 */
export type MarkListener = (animation: string, mark: string) => void;

/**
 * anim plugin events.
 *
 * @example
 * ```ts
 * // A feature plugin waits for the mark its choreography emits.
 * createPlugin("rewardLog", {
 *   depends: [animPlugin],
 *   hooks: ctx => ({ "anim:mark": ({ mark }) => ctx.log.info("mark", { mark }) })
 * }); // the `done` mark of orders.deliver logs { mark: "done" }
 * ```
 */
export type Events = {
  /** A `mark` step was reached, or jumped by `finish()`. */
  "anim:mark": { animation: string; mark: string };
  /** A timeline ended or was finished. Not emitted on `cancel()`. */
  "anim:finished": { animation: string };
};

/**
 * One key of a keyframe track in `defineMotion`: where on the track it sits (`at`, 0..1 of
 * `transition.ms`), the curve of the segment that ends on it (default `"inOut"`) and the pose.
 * `dx` and `dy` are offsets from the rest pose in reference units; `rotation` (radians), `scale`
 * and `alpha` are absolute. A field the key leaves out holds the previous key's value.
 *
 * An enter walk starts on the first key and ends on the rest pose at `at: 1`; an exit walk starts
 * where the view is and ends on the last key, the pose the element leaves in.
 *
 * In a loop (`loop: { track }`) every Transform field is an offset added to the rest pose: `dx`, `dy`, `rotation`
 * and `scale` (`scale: 0.05` grows a scale-1 view to 1.05). `alpha` stays absolute. The loop
 * stands on its first key until that key's `at`, and its last key repeats its first one.
 *
 * @example
 * ```ts
 * // A popup board at 42 % of its swing: 14 u below its rest, tilted 5°, slightly larger.
 * const key: MotionKeyframe = { at: 0.42, ease: "out", Transform: { dy: 14, rotation: 0.087, scale: 1.04 } };
 * ```
 */
export type MotionKeyframe = {
  readonly at: number;
  readonly ease?: Ease;
  readonly Transform?: {
    readonly dx?: number;
    readonly dy?: number;
    readonly rotation?: number;
    readonly scale?: number;
  };
  readonly Shape?: { readonly alpha?: number };
  readonly Sprite?: { readonly alpha?: number };
  readonly NineSlice?: { readonly alpha?: number };
};

/**
 * anim plugin config. The timings live in the steps and in `defineMotion`, not here: a
 * choreography that reads its duration from a config cannot be read as text.
 *
 * @example
 * ```ts
 * createApp({ plugins: [...screen], pluginConfigs: { anim: { maxTracks: 500, reducedMotion: true } } });
 * ```
 */
export type Config = {
  /** Dev guard: one warning each time the running track count rises past this number. */
  maxTracks: number;
  /**
   * Start value of reduced motion: every track but a loop takes 0 ms and every loop stands on
   * its first key. `app.anim.reducedMotion(on)` switches it while the game runs.
   */
  reducedMotion: boolean;
};

/**
 * anim plugin state: the one track table, the field bookkeeping of the retarget policy and the
 * offsets accumulator, the running timelines and the animation registry.
 */
export type State = {
  /** The one track table. Insertion order is advance order. */
  tracks: Map<number, Track>;
  /** Ids of tracks and timelines. */
  nextId: number;
  /** `"<entity>:<component>:<field>"` to the id of the absolute track that drives the field. */
  owner: Map<string, number>;
  /** Per field key, the delta each additive track contributes. */
  offsets: Map<string, Map<number, number>>;
  /** Per field key, the value the offsets are added to. Dropped when no track drives the field. */
  bases: Map<string, number>;
  /** The running timelines, by id. */
  timelines: Map<number, RunningTimeline>;
  /** The `animations` of every feature, read in `onStart`. */
  registry: Map<string, AnyAnimationDefinition>;
  /** `onMark` subscribers, in subscription order. */
  markListeners: Set<MarkListener>;
  /** Counter of the frame steps. A track born in the running step is not advanced by it. */
  frame: number;
  /** True while the track count is over `maxTracks`, so the warning is one per crossing. */
  overMaxTracks: boolean;
  /** The live reduced-motion switch. The frozen `Config.reducedMotion` only seeds it. */
  reducedMotion: boolean;
  /** Remover of `world.projection.setDriver`. */
  removeDriver: (() => void) | undefined;
  /** Remover of `time.onFrame("animate")`. */
  offFrame: (() => void) | undefined;
  /** Remover of `flow.fx.handle("play")`. */
  offPlay: (() => void) | undefined;
  /** Bound in `onInit`, so the teardown context can end everything with the state alone. */
  finishAll: (() => void) | undefined;
};

/**
 * anim plugin API, `app.anim`: play a choreography, end everything, count what runs and listen
 * to the marks. A choreography may spawn temporary entities; they live exactly as long as its
 * timeline.
 *
 * @example
 * ```ts
 * // The board is full: a toast sign drops in, holds for 1.6 s and leaves. Nothing stays behind.
 * const toastBoardFull = defineAnimation("board.toastBoardFull", {
 *   slots: {},
 *   build: () =>
 *     sequence(
 *       spawn("sign", [Text({ content: "Board is full", style: "title" }), Transform({ x: 540, y: -120 })]),
 *       tween(spawned("sign"), Transform, { y: 300 }, { ms: 400, ease: "outBack" }),
 *       wait(1600),
 *       tween(spawned("sign"), Transform, { y: -120 }, { ms: 300, ease: "in" })
 *     )
 * });
 * const handle = app.anim.play(toastBoardFull, {});
 *
 * for (let frame = 0; frame < 150; frame += 1) app.time.step(16);
 * handle.active(); // false: the timeline ended and despawned the sign
 * ```
 */
export type AnimApi = {
  /**
   * Builds the step tree of an animation with the given targets and starts it. The tree runs
   * from the next frame step on, in game time, so `time.setScale` and a pause apply to it. `at`
   * inside `build` answers where a target rests in root space, even inside a scaled slot. A
   * `tween` with `space: "root"` lands a hosted view on such a pose: a board item inside the board
   * slot flies onto an order card of the HUD.
   *
   * @param animation - What `defineAnimation` returned.
   * @param slots - One target, or a list of targets, per declared slot.
   * @returns The handle of the running timeline.
   * @throws {Error} When the tree spawns one id twice.
   * @example
   * ```ts
   * // The reward is claimed: a coin appears on the reward picture and flies to the HUD counter.
   * const coinsFly = defineAnimation("hud.coinsFly", {
   *   slots: { from: type<Target>(), to: type<Target>() },
   *   build: ({ from, to }, { at }) =>
   *     sequence(
   *       spawn("coin1", [
   *         Sprite({ texture: "ui.icon-coin", width: 64, height: 64, fit: "contain" }),
   *         Transform({ x: at(from).x, y: at(from).y })
   *       ], { order: 50 }),
   *       tween(spawned("coin1"), Transform, { x: at(to).x, y: at(to).y }, { ms: 600, ease: "inCubic" }),
   *       mark("landed")
   *     )
   * });
   * const handle = app.anim.play(coinsFly, {
   *   from: { projection: "reward", key: "picture" },
   *   to: { projection: "hud", key: "coins" }
   * });
   *
   * for (let frame = 0; frame < 40; frame += 1) app.time.step(16);
   * handle.marks(); // ["landed"]: the coin reached the counter and was despawned
   * ```
   */
  play<Tags extends SlotTags>(
    animation: AnimationDefinition<Tags>,
    slots: SlotValues<Tags>
  ): PlayHandle;

  /**
   * Ends every track and every timeline now: each writes its exact target, the marks of a
   * running timeline are jumped in tree order, every entity a timeline spawned is despawned and
   * every pending `done` resolves.
   *
   * @example
   * ```ts
   * // A /control tool skips the board-full toast mid-flight: the sign is gone at once.
   * app.anim.play(toastBoardFull, {});
   * app.time.step(16);
   *
   * app.anim.finishAll();
   * app.anim.active(); // 0
   * ```
   */
  finishAll(): void;

  /**
   * How many tracks are in the table, the delayed ones and the running loops included. A loop
   * never ends by itself, so a screen at rest counts one track per loop lane it shows.
   *
   * @returns The number of running tracks.
   * @example
   * ```ts
   * // The assertion every motion test ends with: the screen came to rest.
   * app.anim.active(); // 0
   *
   * // Two order cards sway on their pins (a `loop` of rotation keys): at rest, two loops run.
   * app.anim.active(); // 2
   * ```
   */
  active(): number;

  /**
   * Reads, and with an argument sets, reduced motion. While it is on, every track started from
   * then on takes 0 ms: enter and exit, state changes, change and settle motions, drag returns
   * and timeline tweens land on their target at the next frame, and their marks and sounds still
   * fire. Every loop stands on its first key, a running one at once.
   *
   * @param on - The new value; left out, the value is only read.
   * @returns The value after the call.
   * @example
   * ```ts
   * // The device asks for less motion: web/main.ts follows the system setting.
   * app.anim.reducedMotion(); // false: the start value of Config.reducedMotion
   * app.anim.reducedMotion(true); // true: a popup opened now stands in its rest pose next frame
   * app.anim.reducedMotion(); // true
   * ```
   */
  reducedMotion(on?: boolean): boolean;

  /**
   * Registers a listener called for every mark a timeline reaches, next to the `anim:mark`
   * event. A listener that throws is logged and the listeners after it still run.
   *
   * @param fn - Called with the animation id and the mark name.
   * @returns The remover; calling it twice is a no-op.
   * @example
   * ```ts
   * // A test waits for the "done" mark of the delivery instead of counting frames.
   * const reached: string[] = [];
   * const off = app.anim.onMark((animation, mark) => reached.push(`${animation}:${mark}`));
   *
   * off(); // reached: ["orders.deliver:done"]
   * ```
   */
  onMark(fn: MarkListener): () => void;
};

/**
 * Resolved dependency APIs. `renderer` is not among them: `anim` writes its `Sprite` and reads
 * its `Transform` through the component objects, which are plain data, composes the root pose
 * of `at` with the pure `rootPoseOf` of `renderer/sync/pose.ts`, and turns the target of a
 * `tween` in `space: "root"` local with the pure `localPoseOf` of the same module.
 */
export type Deps = { time: TimeApi; flow: FlowApi; world: WorldApi };

/**
 * What the kernel context offers before the deps are attached.
 *
 * `index.ts` writes `events` with an annotated `register` (core spec `14-EVENT-REGISTRATION.md`
 * row 8), so the own events reach the context the kernel hands the factories and `emit` is the
 * kernel's own, anim-typed one. No member of the context is cast.
 */
export type KernelSlice = PluginCtx<Config, State, Events> & {
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context of the anim plugin: the kernel slice and the three resolved dependencies.
 */
export type AnimCtx = KernelSlice & { readonly deps: Deps };

export type {
  Cursor,
  ExternalPlayer,
  FxStep,
  HapticDescriptor,
  PlayDescriptor,
  RunningTimeline,
  SfxDescriptor,
  Step,
  TimelineRuntime
} from "./timeline/types";
export type { StepMotion, Track } from "./tween/types";
