/**
 * @file world/projection — type definitions: layers, projection specs, views, motion hooks,
 * the tween driver seam and the module API.
 */
import type { Hint } from "../../flow/types";
import type { Json, Root, Snapshot } from "../../model/types";
import type {
  AnyComponent,
  AnyComponentValue,
  ComponentHandle,
  ComponentType,
  EcsApi,
  Entity,
  Owner,
  TagType
} from "../ecs/types";
import type { WorldCtx } from "../types";

/**
 * How a layer orders the entities drawn in it.
 *
 * @example
 * ```ts
 * const sort: LayerSort = "y";
 * ```
 */
export type LayerSort = "none" | "y" | "order";

/**
 * One named layer of a scene. The order of the list is draw order. `above: "overlays"` marks the HUD layer of the
 * scene: drawn above every overlay, never kept in a picture.
 *
 * @example
 * ```ts
 * const layer: LayerSpec = { name: "items", sort: "y" };
 * const hud: LayerSpec = { name: "hud", sort: "none", above: "overlays" };
 * ```
 */
export type LayerSpec = { name: string; sort: LayerSort; above?: "overlays" };

/**
 * Easing of a tween: one of the named curves the driver knows, or a function that gets the
 * normalised time and returns the eased fraction.
 *
 * @example
 * ```ts
 * const ease: Ease = "outBack";
 * ```
 */
export type Ease =
  | "linear"
  | "in"
  | "out"
  | "inOut"
  | "inCubic"
  | "outCubic"
  | "inOutCubic"
  | "inBack"
  | "outBack"
  | ((t: number) => number);

/**
 * What every motion returns: it can be finished, cancelled and asked whether it still runs.
 * V3 `anim` hands out the same shape.
 *
 * @example
 * ```ts
 * const handle: MotionHandle = view.toRest(Transform);
 * handle.active(); // true until the last frame wrote the exact target
 * ```
 */
export type MotionHandle = { finish(): void; cancel(): void; active(): boolean };

/**
 * What a motion hook returns. `void` means the hook wrote the component directly.
 *
 * @example
 * ```ts
 * const motion: Motion = undefined; // the hook called view.set and is already done
 * ```
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a hook may return nothing; `void` names that honestly
export type Motion = MotionHandle | void;

/**
 * Why a motion hook plays: `"mount"` when the view or element comes or goes with its screen (a scene mount or
 * unmount, a load, a restore, a paused or fast world), `"change"` when a commit changed a live screen (a new key,
 * a key that left, a new element in a live tree, a popup). `"discard"` when an aborted scene build dropped the view
 * before it was ever drawn (`projection.discard()`): it plays no exit, so a game's hook never sees it; the removal
 * hook of `ui` reads it through `causeOf` and drops the root at once.
 *
 * @example
 * ```ts
 * const cause: MotionCause = "change";
 * ```
 */
export type MotionCause = "mount" | "change" | "discard";

/**
 * What reduced motion does to one track: `"cut"` (the default) lands it on its target at the next frame step, or holds
 * a loop on its first key; `"keep"` plays it as written. The engine never guesses which tracks are fades: the author
 * marks them.
 *
 * @example
 * ```ts
 * const fade: ReducedMotion = "keep";
 * ```
 */
export type ReducedMotion = "cut" | "keep";

/**
 * Only the numeric fields of a component value: what a tween can interpolate.
 *
 * @example
 * ```ts
 * type Numbers = NumericFields<{ x: number; texture: string }>; // { x: number }
 * ```
 */
export type NumericFields<Value extends object> = {
  [Key in keyof Value as Value[Key] extends number ? Key : never]: Value[Key];
};

/**
 * One keyframe segment of a track: the fraction of the track's `ms` it ends at (`0..1`), the
 * curve it eases with (the track's `ease` when left out) and the numeric fields it reaches. A
 * field it does not name holds where the segment before left it.
 *
 * @example
 * ```ts
 * // The swing of a popup board: past the rest pose at 42 % of the track, then home.
 * const segments: TrackSegment[] = [
 *   { at: 0.42, ease: "out", to: { y: 974, rotation: 0.087 } },
 *   { at: 1, ease: "inOut", to: { y: 960, rotation: 0 } }
 * ];
 * ```
 */
export type TrackSegment = { at: number; ease?: Ease; to: Record<string, number> };

/**
 * Options of `ViewHandle.tween`. An additive tween adds its delta over the value the absolute
 * writer of the field holds, instead of owning the field. `segments` turns the tween into a
 * keyframe walk: the segments run one after another over `ms` on one clock, and `to` is where the
 * last one ends. `repeat` runs the walk again from its first segment when it ends: a number
 * counts the extra runs, `"forever"` never ends. `reduced: "keep"` plays the track as written under
 * reduced motion. The world passes it to the driver unchanged; without a driver the target is
 * written once.
 *
 * @example
 * ```ts
 * const options: TweenOptions = { ms: 350, ease: "out", delayMs: 40 };
 * const fade: TweenOptions = { ms: 250, reduced: "keep" }; // still fades under reduced motion
 * const walk: TweenOptions = { ms: 1000, segments: [{ at: 0.42, to: { y: 974 } }, { at: 1, to: { y: 960 } }] };
 * const sway: TweenOptions = { ms: 2400, additive: true, repeat: "forever", segments: [{ at: 0.5, to: { rotation: 0.05 } }, { at: 1, to: { rotation: 0 } }] };
 * ```
 */
export type TweenOptions = {
  ms: number;
  ease?: Ease;
  delayMs?: number;
  additive?: boolean;
  segments?: readonly TrackSegment[];
  repeat?: number | "forever";
  reduced?: ReducedMotion;
};

/**
 * Options of `ViewHandle.toRest`. Defaults: the plugin's `settleMs` and ease `"out"`. `delayMs`
 * lets a hook wait, for example for a flight to land, before the view comes home. `reduced: "keep"`
 * lets the way home run its length under reduced motion.
 *
 * @example
 * ```ts
 * const options: RestOptions = { ms: 200, delayMs: 120 };
 * const fadeIn: RestOptions = { ms: 200, reduced: "keep" };
 * ```
 */
export type RestOptions = { ms?: number; ease?: Ease; delayMs?: number; reduced?: ReducedMotion };

/**
 * What the driver is told about one track: how long it runs, how it eases, how long it waits,
 * whether it adds to the field or owns it, and the keyframe segments it walks. A track with
 * segments walks them over `ms` on one clock and claims every field a segment names; its target
 * `to` is the last segment's target. A track with `repeat` starts its walk again when it ends
 * (a number counts the extra runs, `"forever"` never ends); the instant driver ignores it and
 * writes the end pose once. `reduced: "keep"` tells the driver the author kept the track under
 * reduced motion; the instant driver ignores that too.
 *
 * @example
 * ```ts
 * const options: TrackOptions = { ms: 250, ease: "outBack", delayMs: 0, additive: false };
 * const kept: TrackOptions = { ms: 250, ease: "out", reduced: "keep" };
 * const walk: TrackOptions = { ms: 1000, segments: [{ at: 0.42, to: { y: 974 } }, { at: 1, to: { y: 960 } }] };
 * const twice: TrackOptions = { ms: 400, ease: "inOut", delayMs: 0, additive: true, repeat: 1 };
 * ```
 */
export type TrackOptions = {
  ms: number;
  ease?: Ease;
  delayMs?: number;
  additive?: boolean;
  segments?: readonly TrackSegment[];
  repeat?: number | "forever";
  reduced?: ReducedMotion;
};

/**
 * The tween engine behind `ViewHandle.tween`, `toRest` and `all`. `anim` installs one with
 * `setDriver`; without it the world writes every target at once.
 *
 * A track reads its start values when its delay ends, writes the exact target on its last frame
 * and goes through `ecs.set`, so `changed()` sees it. Muted fields are never written, also not on
 * `finish()`.
 *
 * A driver with additive tracks keeps the value under them: an additive track adds an offset to
 * it, and an absolute track of 0 ms to a field moves it. Such a driver reports the offsets with
 * `offsetsOf`, so the world can compare the value under a loop with the rest pose.
 *
 * @example
 * ```ts
 * // `anim` hands the world its own tween core in `onStart`.
 * const driver: TweenDriver = {
 *   track: startTrack,
 *   cancelAll: cancelTracksOf,
 *   // A card sways 0.04 rad to one side right now: { rotation: 0.04 }
 *   offsetsOf: addedOffsets
 * };
 * const off = ctx.require(worldPlugin).projection.setDriver(driver);
 *
 * off(); // `anim` stopped: the world writes instantly again
 * ```
 */
export type TweenDriver = {
  /**
   * Starts one track on one component of one entity.
   *
   * @param entity - The entity to animate.
   * @param component - The component to animate.
   * @param to - The numeric target fields.
   * @param options - Duration, easing, delay and the additive flag.
   * @param muted - The fields another writer owns, read at every write.
   * @returns The motion handle of the track.
   */
  track(
    entity: Entity,
    component: AnyComponent,
    to: Record<string, number>,
    options: TrackOptions,
    muted: () => ReadonlySet<string>
  ): MotionHandle;

  /**
   * Ends every track of one entity. Called when a view despawns and on every flush.
   *
   * @param entity - The entity whose tracks end.
   */
  cancelAll(entity: Entity): void;

  /**
   * What the running additive tracks add to each field of one component of one entity right now:
   * the offset of a loop. The world takes it off the stored value before it compares a view with
   * its rest pose, so a view that only sways is home. Optional: a driver without additive tracks
   * leaves it out, and the world reads that as no offset.
   *
   * @param entity - The entity to ask about.
   * @param component - The component to ask about.
   * @returns Field name to the sum of the offsets on it. A field no additive track adds to is
   *   left out.
   */
  offsetsOf?(entity: Entity, component: AnyComponent): Readonly<Record<string, number>>;
};

/**
 * One node of an element description, as `ui` builds it. The world never imports `ui`: it knows
 * the shape structurally, carries it in `Tree` and hands it back unchanged.
 *
 * @example
 * ```ts
 * const node: DescriptionNode = { type: "box", props: { gap: 8 }, children: [] };
 * ```
 */
export type DescriptionNode = {
  type: string;
  key?: string;
  props: object;
  children: readonly unknown[];
};

/**
 * What one `view(item)` call returns: the components of the item, or one description node that
 * the world wraps as `Tree`.
 *
 * @example
 * ```ts
 * const components: ViewOutput = [Level({ level: 2 })];
 * ```
 */
export type ViewOutput = readonly AnyComponentValue[] | DescriptionNode;

/**
 * What a motion hook is handed: the one view it animates. A view never holds a reference to
 * another view — `peer` answers with the other key's item, never with its entity.
 *
 * @example
 * ```ts
 * const enter = (view: ViewHandle<Item>, item: Item): Motion => {
 *   view.set(Transform, { scale: 0 });
 *   return view.toRest(Transform, { ms: 250 });
 * };
 * ```
 */
export type ViewHandle<Item> = {
  readonly entity: Entity;
  readonly key: string;
  get<Value extends object>(component: ComponentType<Value>): Readonly<Value> | undefined;
  rest<Value extends object>(component: ComponentType<Value>): Readonly<Value> | undefined;
  set<Value extends object>(component: ComponentType<Value>, patch: Partial<Value>): void;
  tween<Value extends object>(
    component: ComponentType<Value>,
    to: Partial<NumericFields<Value>>,
    options: TweenOptions
  ): MotionHandle;
  toRest<Value extends object>(
    component: ComponentType<Value>,
    options?: RestOptions
  ): MotionHandle;
  all(handles: readonly Motion[]): MotionHandle;
  peer(key: string): Item | undefined;
};

/**
 * One `motion.change` hook, keyed by component name. `previous` and `next` are both passed, so a
 * rollback that lowers a level can pick another motion than a level-up.
 *
 * @example
 * ```ts
 * const slide: ChangeHook<Item> = view => view.toRest(Transform, { ms: 350 });
 * ```
 */
export type ChangeHook<Item> = (
  view: ViewHandle<Item>,
  previous: Item,
  next: Item,
  hint?: Hint
) => Motion;

/**
 * The `change` table of a projection: one hook per component name.
 *
 * @example
 * ```ts
 * const change: ChangeHooks<Item> = { Transform: view => view.toRest(Transform) };
 * ```
 */
export type ChangeHooks<Item> = { readonly [component: string]: ChangeHook<Item> };

/**
 * The motion hooks of a projection. Every one is optional; without a hook the component diff is
 * written directly. `loop` starts what moves a view for its whole life (an additive sway, a spin):
 * it is played wherever `enter` plays, next to it, and its motion is kept apart from the view's
 * other motions, so a change never cancels it; it ends when the view dies. A view that entered
 * directly (a mount, a load, a restore, a paused or fast world) plays no `enter`, and a direct
 * reconcile ends every track of a view: the loop is then started by the first frame in which the
 * world is live and a tween driver is installed, once.
 *
 * `enter` and `exit` get the cause as their fourth argument; a world projection plays them only for
 * `"change"`; `ui` plays them for both.
 *
 * @example
 * ```ts
 * const motion: ProjectionMotion<Item> = {
 *   change: { Transform: view => view.toRest(Transform, { ms: 350 }) }
 * };
 * // A card that stands at rest when its screen mounts and grows in when a commit adds it.
 * const growing: ProjectionMotion<Item> = {
 *   enter: (view, _item, _hint, cause) => (cause === "mount" ? undefined : view.toRest(Transform, { ms: 200 }))
 * };
 * // An order card that sways forever once it entered.
 * const swaying: ProjectionMotion<Item> = {
 *   loop: view =>
 *     view.tween(Transform, { rotation: 0.05 }, { ms: 1200, additive: true, repeat: "forever" })
 * };
 * ```
 */
export type ProjectionMotion<Item> = {
  enter?(view: ViewHandle<Item>, item: Item, hint?: Hint, cause?: MotionCause): Motion;
  loop?(view: ViewHandle<Item>): Motion;
  exit?(view: ViewHandle<Item>, item: Item, hint?: Hint, cause?: MotionCause): Motion;
  readonly change?: ChangeHooks<Item>;
  settle?(view: ViewHandle<Item>, components: readonly string[]): Motion;
};

/**
 * The motion hooks with the item type erased, as the world stores them.
 *
 * @example
 * ```ts
 * const stored: AnyProjectionMotion = { change: {} };
 * ```
 */
export type AnyProjectionMotion = {
  enter?(view: ViewHandle<unknown>, item: unknown, hint?: Hint, cause?: MotionCause): Motion;
  loop?(view: ViewHandle<unknown>): Motion;
  exit?(view: ViewHandle<unknown>, item: unknown, hint?: Hint, cause?: MotionCause): Motion;
  readonly change?: ChangeHooks<never>;
  settle?(view: ViewHandle<unknown>, components: readonly string[]): Motion;
};

/**
 * One pair of `ProjectionSpec.initialOnly`: a component and the fields of it that `view` gives a
 * view once, when it is born. The field names are checked against the component's own value.
 *
 * @example
 * ```ts
 * const arc: InitialOnlyPair<ShapeValue> = [Shape, ["sweep"]];
 * ```
 */
export type InitialOnlyPair<Value extends object> = readonly [
  ComponentHandle<Value>,
  readonly (keyof Value & string)[]
];

/**
 * The `initialOnly` list of a projection: one pair for each value type of `Values`, each pair
 * checked against its own component. `projection()` infers `Values` from the list, so
 * `[[Shape, ["swep"]]]` is a type error.
 *
 * @example
 * ```ts
 * const fields: InitialOnly<[ShapeValue, TransformValue]> = [
 *   [Shape, ["sweep", "alpha"]],
 *   [Transform, ["rotation"]]
 * ];
 * ```
 */
export type InitialOnly<Values extends readonly object[]> = {
  readonly [Index in keyof Values]: InitialOnlyPair<Values[Index]>;
};

/**
 * One projection: keyed items of the model turned into entities. `Item` is inferred from the
 * return of `from`; `layer` and `lift` keep their literal types so a scene can check them.
 * `Values` are the value types of the `initialOnly` pairs, inferred by `projection()`; an
 * annotation that leaves it out accepts any field name.
 *
 * @example
 * ```ts
 * const spec: ProjectionSpec<Item, "items", "lifted", Player, Session> = {
 *   name: "board.items",
 *   layer: "items",
 *   lift: "lifted",
 *   from: player => player.board.items,
 *   key: item => item.id,
 *   view: item => [Item({ level: item.level })]
 * };
 * ```
 */
export type ProjectionSpec<
  Item,
  LayerName extends string,
  LiftName extends string,
  Player,
  Session,
  Values extends readonly object[] = readonly Record<string, unknown>[]
> = {
  readonly name: string;
  readonly layer: LayerName;
  readonly lift?: LiftName;
  from(player: Player, session: Session): readonly Item[] | Item;
  /** Omitted when `from` returns one plain object: the key is then the name of the projection. */
  key?(item: Item): string;
  view(item: Item): ViewOutput;
  readonly motion?: ProjectionMotion<Item>;
  /**
   * Fields another writer owns once a view is born. `view` gives them their first value when the
   * view spawns; from then on nothing of the projection writes or compares them: not a changed
   * item, not a motion or its finish, not the check at the end of a motion (no
   * `world:view-corrected`), not a rollback, `settle(entity)`, a restore or a load. These are the
   * rules of `mute()`, for every view of the projection and for its whole life. A `mute()` on the
   * view adds to them, and its release keeps them. Left out, the projection writes every field.
   *
   * @example
   * ```ts
   * // The timer ring of a chest: born full, then the system `board.rings` draws its arc from `Now`.
   * export const marks = projection({
   *   name: "board.marks",
   *   layer: "marks",
   *   from: (player: Player) => player.board.timers,
   *   key: timer => timer.id,
   *   view: timer => [Shape({ kind: "arc", w: 28, h: 28, strokeWidth: 2.2, sweep: 1 })],
   *   motion: {
   *     enter: view => {
   *       view.set(Shape, { alpha: 0 });
   *       return view.toRest(Shape, { ms: 200 });
   *     }
   *   },
   *   initialOnly: [[Shape, ["sweep"]]]
   * });
   * // The fade ends with the 0.42 the system wrote: no full ring, no `world:view-corrected`.
   * ```
   */
  readonly initialOnly?: InitialOnly<Values>;
};

/**
 * A projection spec with its item and layer types erased, as the world stores it.
 *
 * @example
 * ```ts
 * const stored: AnyProjectionSpec = {
 *   name: "board.items",
 *   layer: "items",
 *   from: () => [],
 *   key: () => "",
 *   view: () => []
 * };
 * ```
 */
export type AnyProjectionSpec = {
  readonly name: string;
  readonly layer: string;
  readonly lift?: string;
  from(player: Json, session: Json): unknown;
  key?(item: unknown): string;
  view(item: unknown): ViewOutput;
  readonly motion?: AnyProjectionMotion;
  /** The `initialOnly` pairs, their field names no longer tied to the component. */
  readonly initialOnly?: readonly (readonly [ComponentHandle<object>, readonly string[]])[];
};

/**
 * Why a reconcile runs. Merged over the frame; the cause table decides play or direct. A
 * `"restore"` and a `"load"` replace the state, so their reconcile also brings every live view to
 * its rest pose, whether its item changed or not, and every element to the rest pose its owner
 * recorded with `setRest`. A `"rollback"` commits the state of the last rest point: a live view
 * whose item did not change and that stands off its rest pose is settled, as `settle(entity)`
 * does. An element another plugin owns is not.
 *
 * @example
 * ```ts
 * const cause: Cause = "edge";
 * ```
 */
export type Cause = "edge" | "rollback" | "restore" | "load" | "mount" | "rerun";

/**
 * One live or exiting view: the entity of one key of one projection, its rest pose and the
 * motions that still run on it.
 */
export type View = {
  entity: Entity;
  projection: string;
  key: string;
  /** `{ projection, key }`, made once with the view: what `keyOf` answers, every call the same object. */
  readonly address: ProjectionKey;
  item: unknown;
  /** The last output of `view(item)`, by component name: what the picture equals at rest. */
  rest: Map<string, AnyComponentValue>;
  handles: MotionHandle[];
  lifted: boolean;
  /** `lift(false)` is waiting for the last motion to end. */
  dropWhenStill: boolean;
  /**
   * The `loop` hook of the view is still to be started. Set when the view enters in a direct
   * reconcile, which plays no hook, and whenever a flush ends its tracks, the loop among them.
   * The sweep starts the loop and clears the flag, only while the world is live and a tween
   * driver is installed. It is the only trigger, so a loop starts once.
   */
  loopOwed: boolean;
  exiting: boolean;
  /** How the view came, then how it leaves. */
  cause: MotionCause;
};

/**
 * One mounted projection: its owner, the live views by key, the despawn queue, the items of the
 * last reconcile, its place in the list of its scene and the layer list of that scene.
 *
 * @example
 * ```ts
 * const mounted: Mounted = {
 *   owner: { kind: "projection", name: "board.items" },
 *   live: new Map(),
 *   queue: [],
 *   items: new Map(),
 *   order: -1,
 *   layers: Object.freeze([{ name: "items", sort: "y" }])
 * };
 * ```
 */
export type Mounted = {
  owner: Owner;
  live: Map<string, View>;
  queue: View[];
  items: Map<string, unknown>;
  /**
   * The `Order` a screen root of this projection draws at in its layer: its place in the list `mount` was given,
   * minus the length of that list (the roots of one scene take −n … −1, in list order).
   */
  order: number;
  /**
   * The layer list (`setLayers`) of the scene the projection was mounted into or kept by last, compared by
   * identity: a `mount` under the same list is a second mount of one scene, a `mount` under a new one keeps it.
   */
  layers: ReadonlyArray<LayerSpec>;
  /**
   * The state of its last reconcile: a play reconcile against the same `player` and `session` trees changes nothing
   * and is passed over (the frame after a scene mounted it direct). Absent before the first reconcile.
   */
  seen?: Snapshot;
};

/**
 * One track the projection started on the driver. The world keeps the component name and the
 * handle, so it knows which components are driven without knowing how the driver runs them.
 */
export type Track = {
  entity: Entity;
  component: string;
  handle: MotionHandle;
  /**
   * Whether the track adds to its fields instead of owning them, as the loop of a view does. An
   * additive track drives no component: a settle may bring the component home under it.
   */
  additive: boolean;
};

/**
 * The rest pose of one entity, by component name: the last output of `view(item)` for a view, or
 * what `setRest` recorded for an element another plugin owns.
 */
export type RestPose = Map<string, AnyComponentValue>;

/**
 * Where a keyed element lives: a plugin above registered it with `registerKey`, so `entityOf`
 * and `keyOf` answer for it next to the views.
 *
 * @example
 * ```ts
 * const key: ProjectionKey = { projection: "hud", key: "coins" };
 * ```
 */
export type ProjectionKey = { projection: string; key: string };

/**
 * What the next reconcile has to do: why it runs, which roots changed and whether `view` is
 * forced for every item.
 *
 * @example
 * ```ts
 * const dirty: Dirty = { causes: ["edge"], roots: new Set(["player"]), force: false };
 * ```
 */
export type Dirty = { causes: Cause[]; roots: Set<Root>; force: boolean };

/**
 * Component name to the fields another writer owns, of one entity. A frozen table, and a frozen
 * set in one, is the `initialOnly` seed every view of one projection shares: nothing writes into
 * it, and `mute()` copies it before it adds a field.
 */
export type MuteTable = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * A mute's fields joined with a type's owned fields, and the owned set they were joined with.
 */
export type JoinedFields = {
  readonly owned: ReadonlySet<string>;
  readonly joined: ReadonlySet<string>;
};

/**
 * projection module state.
 */
export type ProjectionState = {
  specs: Map<string, AnyProjectionSpec>;
  layers: readonly LayerSpec[];
  mounted: Map<string, Mounted>;
  byEntity: Map<Entity, View>;
  dirty: Dirty | undefined;
  hints: Hint[];
  /** The tracks the projection started, with the handle that says whether they still run. */
  tracks: Track[];
  /** The tween engine `anim` installed, or `undefined`: then every target is written at once. */
  driver: TweenDriver | undefined;
  /**
   * The rest pose of an entity that is not a view, recorded by its owner through `setRest`. The
   * entry of an entity that is gone is dropped by the sweep and by the converge step.
   */
  rests: Map<Entity, RestPose>;
  /** Projection name to key to the entity a plugin above registered under it. */
  keys: Map<string, Map<string, Entity>>;
  /**
   * The reverse of `keys`, so `keyOf` answers for a registered element too. The entry of an
   * entity that is gone is dropped with its rest pose, and its side of `keys` with it.
   */
  keysByEntity: Map<Entity, ProjectionKey>;
  /**
   * Entity to component name to the fields another writer owns: what `mute()` handed over, and
   * the shared `initialOnly` seed a view of such a projection is born with. A view a listener of
   * its spawn muted keeps that table, and the seed joins it.
   */
  mutes: Map<Entity, MuteTable>;
  /** The `initialOnly` seed of each registered spec that has one, frozen, built at `register` and `replace`. */
  initialOnly: WeakMap<AnyProjectionSpec, MuteTable>;
  /** The owned fields of each component type as a set, by the type's frozen `owned` list: made once. */
  ownedSets: WeakMap<readonly string[], ReadonlySet<string>>;
  /** The muted and the owned fields joined, by the mute's field set: dropped when `mute()` or its release changes it. */
  joinedMutes: WeakMap<ReadonlySet<string>, JoinedFields>;
  /** The `onConverged` listeners: the owners of elements, told after a restore or a load. */
  converged: Array<() => void>;
  offHints: Array<() => void>;
  /** The cause of every view despawned since the last sweep, so a removal hook can still ask. */
  leaving: Map<Entity, MotionCause>;
  /**
   * Moves on every time a view enters `live`, leaves it, or leaves `leaving`, and on a clear:
   * `ui` hosts the views of a projection again only when it moved (`projection.membershipVersion()`).
   */
  membershipVersion: number;
  /**
   * A live view may hold a running handle: set by every view handle made, cleared by a sweep that
   * walked the live views and found none moving. While it is false the sweep walks no live view.
   */
  moving: boolean;
  /** Views were marked as owing their loop since the last start of the owed loops. */
  owedLoops: number;
  /**
   * The despawn count of the ecs when the sweep last looked for dead elements; -1 after a new
   * key, so the next sweep looks.
   */
  sweptDespawns: number;
  /** The running build of the next scene; absent when none runs, never written as `undefined`. */
  building?: Building;
  /** The `onBuild` checks: every one answers true before `built()` does. Kept across builds. */
  buildChecks: Array<() => boolean>;
};

/**
 * The build of the next scene aside (spec 31): its projections mounted into a table of their own, so a name never has
 * two records in `mounted`, and every entity the build spawned, so `isBuilding` answers with one lookup. Absent while
 * no build runs.
 */
export type Building = {
  /** The projection list of the coming scene, in its order: the places of its screen roots. */
  names: readonly string[];
  /** The layer list of the coming scene, as the caller handed it: the build checked the names against it. */
  layers: ReadonlyArray<LayerSpec>;
  /** Who owns the entities of the projections the build mounts. */
  owner: Owner;
  /** The projections only the coming list names, mounted aside until the commit moves them into `mounted`. */
  mounted: Map<string, Mounted>;
  /** Every entity of the build: the views it spawned and the entities `adopt` marked. */
  entities: Set<Entity>;
  /** The game clock at the start of this frame (world's `input` phase), or at the build start in its own frame. */
  frameStart: number;
  /** Milliseconds per frame the building work may take. */
  budgetMs: number;
  /**
   * Whether a reconcile passed over a mounted projection the coming list drops, which keeps what it showed when the
   * switch began: `"change"`, or `"rerun"` when that reconcile forced `view`. The commit and the discard then mark the
   * world dirty, so one still mounted reads the store in the next frame. Absent while none was passed over.
   */
  held?: "change" | "rerun";
};

/**
 * The world-owned components the projection writes. Injected, because a module never imports a
 * sibling module's run-time code.
 *
 * @example
 * ```ts
 * const injected: WorldComponents = { Layer, Order, Exiting };
 * ```
 */
export type WorldComponents = {
  Layer: ComponentType<{ name: string }>;
  Order: ComponentType<{ value: number }>;
  Exiting: TagType;
  Tree: ComponentType<{ node: DescriptionNode }>;
};

/**
 * What `index.ts` injects into the projection factory: the sibling module and the world-owned
 * components, because a module never imports a sibling's run-time code.
 */
export type ProjectionDeps = {
  ecs: EcsApi;
  components: WorldComponents;
};

/**
 * Domain context of the projection module: the plugin context and the injected sibling.
 */
export type ProjectionCtx = { readonly ctx: WorldCtx; readonly deps: ProjectionDeps };

/**
 * The counters of one reconcile, without the mode.
 *
 * @example
 * ```ts
 * const counts: Counts = {
 *   projections: 1,
 *   entered: 0,
 *   changed: 1,
 *   exited: 1,
 *   revived: 0,
 *   queued: 1,
 *   hintsRouted: 1,
 *   hintsDropped: 0
 * };
 * ```
 */
export type Counts = {
  projections: number;
  entered: number;
  changed: number;
  exited: number;
  revived: number;
  queued: number;
  hintsRouted: number;
  hintsDropped: number;
};

/**
 * What one reconcile run is asked to do.
 */
export type ReconcileOptions = {
  names?: readonly string[];
  direct: boolean;
  force: boolean;
  /**
   * Whether every live view is written to its rest pose when the reconcile ends, also a view
   * whose item did not change, and with it every element whose owner recorded a rest pose. Set
   * for a restore and a load, and only together with `direct`: the flush of a direct reconcile
   * ends every motion first.
   */
  converge: boolean;
  /**
   * Whether a live view whose item did not change is settled when it stands off its rest pose.
   * Set when a rollback is among the causes: the failed node committed nothing, so no entry
   * brings back a view it moved. A play reconcile cancels the motions of the view and plays its
   * settle; a direct one writes the rest pose after the flush.
   */
  settle: boolean;
  /**
   * The table of mounted projections to reconcile: `mounted` when left out, the table of the running build for the
   * build start. A reconcile of `mounted` that is not limited by `names` reconciles the building table too, direct.
   */
  table?: Map<string, Mounted>;
  /**
   * Whether a throw of an entry (a `view` that throws) leaves the reconcile instead of being logged: the build start
   * drops what it spawned and throws it on.
   */
  strict?: boolean;
};

/**
 * projection module API, `app.world.projection`: the bridge from the model to entities.
 *
 * @example
 * ```ts
 * // A test mounts the board and asks which entity carries one model key.
 * app.world.projection.mount(["board.items"], { kind: "plugin", name: "test" });
 * app.world.projection.entityOf("board.items", "i7"); // 1048576
 * ```
 */
export type ProjectionApi = {
  /**
   * Stores a projection spec. Nothing is drawn until `mount`.
   *
   * @param spec - The projection, built with `projection()`.
   * @throws {Error} When a projection of that name is already registered.
   * @example
   * ```ts
   * // A test registers one projection by hand instead of composing a feature.
   * app.world.projection.register(boardItems);
   * app.world.projection.entityOf("board.items", "i7"); // undefined: nothing is mounted yet
   * ```
   */
  register(spec: AnyProjectionSpec): void;

  /**
   * Swaps the stored spec of a registered projection. A mounted one has its layers checked against
   * the current scene and runs the new `view` for every item on the next frame, directly. An
   * unmounted one is only stored; its next `mount` uses it. Nothing changes when the call throws.
   *
   * @param spec - The new projection, under the name it was registered with.
   * @throws {Error} When no projection of that name is registered, or when a mounted one names a
   * `layer` or `lift` the scene does not declare.
   * @example
   * ```ts
   * // The dev hot swap in `ui`: the saved `view.ts` exports a new `boardItems`.
   * const world = ctx.require(worldPlugin);
   * world.projection.replace(boardItems); // the next frame draws every item with the new view
   * world.projection.replace(shopItems); // throws: Projection "shop.items" is not registered
   * ```
   */
  replace(spec: AnyProjectionSpec): void;

  /**
   * Stores the layer list of the scene. The order of the list is draw order; every call stores a
   * new frozen array.
   *
   * @param list - The layers, in draw order.
   * @example
   * ```ts
   * // `scenes` switches to the board scene.
   * const world = ctx.require(worldPlugin);
   * world.projection.setLayers([
   *   { name: "board", sort: "none" },
   *   { name: "items", sort: "y" },
   *   { name: "lifted", sort: "none" }
   * ]);
   * ```
   */
  setLayers(list: ReadonlyArray<LayerSpec>): void;

  /**
   * The current layer list, empty before the first `setLayers`. A new list is a new reference, so
   * a reader compares by identity.
   *
   * @returns The layers, in draw order.
   * @example
   * ```ts
   * // `renderer.sync` rebuilds its containers only when the scene really changed.
   * const current = app.world.projection.layers();
   * if (current !== lastLayers) rebuildContainers(current); // [{ name: "board", sort: "none" }, ...]
   * ```
   */
  layers(): ReadonlyArray<LayerSpec>;

  /**
   * Marks projections mounted under an owner and reconciles them at once, direct: a scene brings
   * its own transition. A screen root draws at the `Order` of its place in the list, −n … −1. A
   * projection a scene before mounted (under another layer list, `setLayers`) stays mounted when
   * the new list declares its `layer` and `lift` alike: its views keep their entities and their
   * motions, no hook runs, and its screen roots take the `Order` of their place in this list. One
   * whose layer the new list declares otherwise is unmounted and mounted again. One mounted under
   * the current layer list already is a second mount of one scene: it warns
   * `world:already-mounted` and changes nothing. Nothing is mounted when the call throws.
   *
   * @param names - Names of the projections to mount.
   * @param owner - Who owns the entities of these projections.
   * @throws {Error} For an unknown name, or a `layer` or `lift` the scene does not declare.
   * @example
   * ```ts
   * // `scenes` mounts the board scene it just switched to: its HUD screen is listed last, at -1.
   * const world = ctx.require(worldPlugin);
   * world.projection.mount(["board.items", "hud"], { kind: "plugin", name: "scenes" });
   * world.projection.entityOf("board.items", "i7"); // 1048576, the picture is already there
   *
   * // The shop lists the HUD too and declares `ui` alike: the shop's layers, the board's items
   * // out, the shop's list in.
   * world.projection.setLayers([{ name: "ui", sort: "order" }]);
   * world.projection.unmount(["board.items"]);
   * world.projection.mount(["hud", "shop.shelf"], { kind: "plugin", name: "scenes" });
   * world.ecs.get(world.projection.entityOf("hud", "hud") ?? 0, Order)?.value; // -2: the same entity, first of two
   * ```
   */
  mount(names: readonly string[], owner: Owner): void;

  /**
   * Unmounts projections: every motion of their views is finished, and the live views and the
   * despawn queue are despawned in the same call.
   *
   * @param names - Names of the projections to unmount.
   * @example
   * ```ts
   * // `scenes` leaves the board scene.
   * const world = ctx.require(worldPlugin);
   * world.projection.unmount(["board.cells", "board.items"]);
   * world.projection.entityOf("board.items", "i7"); // undefined
   * ```
   */
  unmount(names: readonly string[]): void;

  /**
   * A drop with no commit: cancels the view's motions and plays settle for every loose component.
   * A view that loops comes home too, and its loop runs on. In mode `paused` or `fast` the rest
   * pose is written at once. No-op for an entity that is not a live view.
   *
   * @param entity - The entity of the view that was dropped.
   * @example
   * ```ts
   * // `input` released the finger over nothing, so the gate refused the answer.
   * const world = ctx.require(worldPlugin);
   * world.projection.settle(held); // the item glides back to its cell over settleMs
   * ```
   */
  settle(entity: Entity): void;

  /**
   * Hands a set of fields to another writer. Tracks never write them, also not on `finish()`. On
   * a view whose projection names `initialOnly` fields the mute adds to them, and the remover keeps
   * them.
   *
   * @param entity - The entity of the view.
   * @param component - The component whose fields are taken over.
   * @param fields - The field names the caller owns.
   * @returns The remover; safe after the entity left, and a no-op when called twice.
   * @example
   * ```ts
   * // `input` owns the position of the held view while the finger drags it.
   * const world = ctx.require(worldPlugin);
   * const release = world.projection.mute(held, Transform, ["x", "y"]);
   *
   * release(); // the finger let go
   * ```
   */
  mute(entity: Entity, component: ComponentType<object>, fields: readonly string[]): () => void;

  /**
   * Moves a view into or out of its projection's `lift` layer. `lift(entity, false)` on a view
   * that still moves takes effect when its last motion ends, so a settling view stays above the
   * board until it is home. A reconcile or a `settle(entity)` that ends the motions of the view
   * applies the pending drop itself.
   *
   * @param entity - The entity of the view.
   * @param on - True to lift, false to drop back.
   * @example
   * ```ts
   * // `input` lifts the item the finger picked up so it draws above the board.
   * const world = ctx.require(worldPlugin);
   * world.projection.lift(held, true);
   *
   * world.projection.lift(held, false); // on release: takes effect when the settle motion ends
   * ```
   */
  lift(entity: Entity, on: boolean): void;

  /**
   * The projection and key of an entity. Also answers for a view in the despawn queue and for an
   * element registered with `registerKey`. A view answers the address it keeps for its life, the
   * same frozen object every call, so asking every frame allocates nothing.
   *
   * @param entity - The entity to ask about.
   * @returns The projection name and the key, or `undefined`.
   * @example
   * ```ts
   * // `renderer.sync` labels its display objects for the inspector.
   * app.world.projection.keyOf(1_048_576); // { projection: "board.items", key: "i7" }
   * app.world.projection.keyOf(1_048_576) === app.world.projection.keyOf(1_048_576); // true
   * app.world.projection.keyOf(42); // undefined: not a view
   * ```
   */
  keyOf(entity: Entity): ProjectionKey | undefined;

  /**
   * A number that moves every time a view enters the live views of a mounted projection, leaves
   * them (an exit or a despawn), or is forgotten after its despawn, and when the projections are
   * cleared. An equal number means the same views live as at the last read, so a plugin that
   * works on the live views (`ui` hosting them in an element) skips its step while it holds.
   * Reading it allocates nothing.
   *
   * @returns The version; 0 for a world where no view ever came or went.
   * @example
   * ```ts
   * // ui, at the start of its hosting step: nothing to do while no view came or went.
   * const version = ctx.require(worldPlugin).projection.membershipVersion(); // 7, as on the last frame
   * if (version === state.hostedMembership) return;
   * ```
   */
  membershipVersion(): number;

  /**
   * How the view of an entity came, or how it is leaving: `"mount"` when a direct reconcile or an unmount moved it,
   * `"change"` when a live commit did, `"discard"` when `discard()` dropped the build it belonged to. A despawned view
   * still answers until the next sweep, so a hook on its removal can ask. `undefined` for an entity no projection made.
   *
   * @param entity - A view, or a view in its removal hook.
   * @returns The cause, or `undefined`.
   * @example
   * ```ts
   * // ui, in the `Tree` removal hook of a screen root whose scene was switched away:
   * ctx.require(worldPlugin).projection.causeOf(root); // "mount"
   * ```
   */
  causeOf(entity: Entity): MotionCause | undefined;

  /**
   * The components a motion still drives on an entity: its running tracks, in start order, each
   * name once. An entity no motion drives answers `[]`: a resting view, an entity that is not a
   * view, a stale id. Every call hands out a new array.
   *
   * @param entity - The entity to ask about.
   * @returns The component names, or `[]`.
   * @example
   * ```ts
   * // The editor explains a coin in flight: its Transform still tweens, its Sprite rests.
   * app.world.projection.motionsOf(coin); // ["Transform"]
   * app.time.step(400);
   * app.world.projection.motionsOf(coin); // []
   * ```
   */
  motionsOf(entity: Entity): readonly string[];

  /**
   * The rest value of one component of an entity: what a view holds when nothing animates it, or
   * what `setRest` recorded for an element. Read-only and owner-free, so a plugin that owns no
   * entity can aim at one.
   *
   * @param entity - A projection view or a registered element.
   * @param component - The component whose rest value is asked.
   * @returns The rest value, or `undefined` when the entity has none recorded.
   * @example
   * ```ts
   * // `anim` builds a coin flight toward the counter: `at(target)` is the counter's rest pose.
   * const world = ctx.require(worldPlugin);
   * const counter = world.projection.entityOf("hud", "coins") ?? 0;
   *
   * world.projection.restOf(counter, Transform); // { x: 40, y: 120, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }
   * ```
   */
  restOf<Value extends object>(entity: Entity, component: ComponentType<Value>): Value | undefined;

  /**
   * The entity of one key of one projection: a live view, never the despawn queue, or an element
   * a plugin above registered under that key.
   *
   * @param projection - Name of the projection.
   * @param key - The model key.
   * @returns The entity, or `undefined`.
   * @example
   * ```ts
   * // `input` resolves the target of a scripted drag.
   * const world = ctx.require(worldPlugin);
   * world.projection.entityOf("board.items", "i7"); // 1048576
   * world.projection.entityOf("board.items", "gone"); // undefined
   * ```
   */
  entityOf(projection: string, key: string): Entity | undefined;

  /**
   * The live view entities of a mounted projection, in the order of its model keys. A view that
   * plays its exit is left out, and so is an element registered with `registerKey`. A projection
   * the running build mounts answers its building views (`isBuilding` tells them apart), so a host
   * of the coming scene can take them before the swap. Every call hands out a new array.
   *
   * @param name - Name of the projection.
   * @returns The entities, or `[]` when the projection is neither mounted nor being built.
   * @example
   * ```ts
   * // `ui` hosts the board inside a slot and parents every board item to it on reconcile.
   * const world = ctx.require(worldPlugin);
   * world.projection.entitiesOf("board.items"); // [1048580, 1048581]
   * world.projection.entitiesOf("shop.items"); // []: not mounted
   * ```
   */
  entitiesOf(name: string): readonly Entity[];

  /**
   * Installs the tween engine every `ViewHandle.tween`, `toRest` and `all` then runs on. Without
   * one the world writes every target at once and hands back an inactive handle.
   *
   * @param driver - The engine that runs the tracks.
   * @returns The remover; it puts the instant writes back.
   * @example
   * ```ts
   * // `anim` installs its tween core when it starts and takes it back when it stops.
   * const world = ctx.require(worldPlugin);
   * ctx.state.removeDriver = world.projection.setDriver(createDriver(ctx, ctx.state));
   *
   * ctx.state.removeDriver(); // onStop: motions are instant again
   * ```
   */
  setDriver(driver: TweenDriver): () => void;

  /**
   * A view handle for an entity that is not a projection view, so an element another plugin owns
   * can be animated the same way. `set`, `get`, `tween`, `toRest` and `all` work; `rest` answers
   * what `setRest` recorded; `peer` answers `undefined`.
   *
   * @param entity - The entity of the element.
   * @param owner - Who is asking; without it only the kind of the owner is checked.
   * @returns The handle, or `undefined` for a projection view and for a foreign entity.
   * @example
   * ```ts
   * // `ui` plays the `motion` prop of an element it owns.
   * const world = ctx.require(worldPlugin);
   * const handle = world.projection.viewOf(button, { kind: "plugin", name: "ui" });
   *
   * handle?.tween(Transform, { scale: 1.1 }, { ms: 120, ease: "outBack" });
   * ```
   */
  viewOf(entity: Entity, owner: Owner): ViewHandle<unknown> | undefined;

  /**
   * Records what one component of an element looks like at rest, so `toRest` knows where home is.
   * It is also where a restore and a load put the element: after their reconcile every track on
   * the entity is ended and every recorded component it still carries is written, muted fields
   * left out. So the owner records the pose it draws the element with, every time that changes.
   * The pose of an entity that is gone is dropped in the next live frame.
   *
   * @param entity - The entity of the element.
   * @param component - The component whose rest value is recorded.
   * @param value - The value the element holds when nothing animates.
   * @example
   * ```ts
   * // `ui` laid the coin counter out and tells the world where it belongs.
   * const world = ctx.require(worldPlugin);
   * world.projection.setRest(counter, Transform, { x: 40, y: 120, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } });
   *
   * world.projection.viewOf(counter, { kind: "plugin", name: "ui" })?.rest(Transform); // { x: 40, y: 120, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }
   * ```
   */
  setRest<Value extends object>(
    entity: Entity,
    component: ComponentType<Value>,
    value: Value
  ): void;

  /**
   * Gives an entity a projection and key of its own, so `entityOf` and `keyOf` answer for it next
   * to the live views. That is how an element becomes a target for `anim`, `input` and `guide`.
   * A key whose entity is gone is dropped in the next live frame, also when the remover was never
   * called.
   *
   * @param projection - Name the element is addressed under.
   * @param key - Key the element is addressed under.
   * @param entity - The entity of the element.
   * @returns The remover; it drops the key again.
   * @throws {Error} When a live view of that projection already holds the key.
   * @example
   * ```ts
   * // `ui` publishes the coin counter of the HUD.
   * const world = ctx.require(worldPlugin);
   * const drop = world.projection.registerKey("hud", "coins", counter);
   *
   * world.projection.entityOf("hud", "coins"); // the entity of the counter
   * drop(); // the element left the screen
   * ```
   */
  registerKey(projection: string, key: string, entity: Entity): () => void;

  /**
   * Calls a listener after a reconcile a restore or a load caused. By then every live view and
   * every element with a recorded rest pose stands on that pose, and every track on them is
   * ended, also a loop the owner of an element started. The owner puts back what only it knows.
   *
   * @param listener - Called once after each such reconcile.
   * @returns The remover; calling it twice is safe.
   * @example
   * ```ts
   * // `ui` builds its roots again after a restore, so each element stands as freshly mounted.
   * const world = ctx.require(worldPlugin);
   * const off = world.projection.onConverged(() => jsx.converged());
   *
   * off(); // onStop: `ui` is gone
   * ```
   */
  onConverged(listener: () => void): () => void;

  /**
   * Marks every mounted projection dirty and forces `view` for every item, so the next frame
   * rebuilds the picture directly.
   *
   * @example
   * ```ts
   * // The ui hot swap replaced the saved `hud` projection: every mounted view runs `view` again.
   * const world = ctx.require(worldPlugin);
   * world.projection.replace(hud);
   * world.projection.rerunAll(); // the next frame draws the new view, with no motion
   * ```
   */
  rerunAll(): void;

  /**
   * Starts building the next scene aside, while the current one stays mounted, drawn and alive. The projections only
   * the coming list names are mounted at once, direct, against the committed state, into a table of their own: their
   * views are spawned and flagged building (`isBuilding`), and their screen roots take the `Order` of their place in
   * the coming list. `entityOf` does not answer for them until `commit`. A projection the current scene mounts and
   * the coming list declares alike (F23) is not touched now. Answers `false` and touches nothing when a listed
   * projection is mounted now under other layer rules: building it beside its live twin would need two records under
   * one name, so the caller takes the one-block path (`setLayers`, `unmount`, `mount`). Nothing is built when the call
   * throws: the entities a throwing `view` left behind are despawned first.
   *
   * @param names - The projection list of the coming scene, in its order.
   * @param owner - Who owns the entities of the projections the build mounts.
   * @param layers - The layer list of the coming scene: the names are checked against it, not the current list.
   * @param budgetMs - Milliseconds per frame the building work of the other plugins may take, read through `left`.
   * @returns True when the build runs, false when a listed projection is mounted now under other layer rules.
   * @throws {Error} When a build already runs, for an unknown name, for a `layer` or `lift` the coming list does not
   *   declare, and when a `view` throws.
   * @example
   * ```ts
   * // `scenes` leaves the ward, whose HUD draws in `ui` sorted by order.
   * const projection = ctx.require(worldPlugin).projection;
   *
   * // The shop sorts `ui` otherwise: nothing is built, `scenes` mounts the shop in one block.
   * projection.build(
   *   ["hud", "shop.shelf"],
   *   { kind: "plugin", name: "scenes" },
   *   [{ name: "ui", sort: "none" }],
   *   4
   * ); // false
   *
   * // The board declares `ui` alike: the HUD stays, the board items are built aside.
   * projection.build(
   *   ["board.items", "hud"],
   *   { kind: "plugin", name: "scenes" },
   *   [{ name: "items", sort: "y" }, { name: "ui", sort: "order" }],
   *   4
   * ); // true
   * projection.entityOf("board.items", "i7"); // undefined until the commit
   *
   * // A second build before the commit or the discard of the first:
   * projection.build(["shop.shelf"], { kind: "plugin", name: "scenes" }, [{ name: "ui", sort: "none" }], 4);
   * // throws: A scene is already being built
   * ```
   */
  build(
    names: readonly string[],
    owner: Owner,
    layers: ReadonlyArray<LayerSpec>,
    budgetMs: number
  ): boolean;

  /**
   * Whether the running build is done: true when a build runs and every `onBuild` check answers true, false without a
   * build. A caller polls it once a frame; it is never an event.
   *
   * @returns True when the build can be committed.
   * @example
   * ```ts
   * // `scenes`, in its `signals` callback while the board builds:
   * const projection = ctx.require(worldPlugin).projection;
   * projection.built(); // false on the first build frame: the renderer still creates views
   * projection.built(); // true two frames later: commit now
   * ```
   */
  built(): boolean;

  /**
   * The swap of a build: its projections become mounted, each at the `Order` of its place in the coming list as
   * `mount` would write it, a kept projection (F23) takes its new place, every building flag clears and the table is
   * dropped. Each moved and kept projection takes the layer list `setLayers` stored just before, so the next scene
   * compares it by identity as after a `mount`. The loops of the moved views start in the next live sweep. Does nothing
   * without a build.
   *
   * @example
   * ```ts
   * // `scenes`, in the frame `built()` first answers true: the layers, the leaving list out, the build in.
   * const projection = ctx.require(worldPlugin).projection;
   * projection.setLayers([{ name: "items", sort: "y" }, { name: "ui", sort: "order" }]);
   * projection.unmount(["ward.beds"]);
   * projection.commit();
   * projection.entityOf("board.items", "i7"); // 1048600: mounted now
   * projection.built(); // false: nothing builds any more
   * ```
   */
  commit(): void;

  /**
   * Drops the running build: every entity it spawned, its views and the entities `adopt` marked, is despawned at once
   * with no motion, and the table is dropped. A dropped view leaves with the cause `"discard"`, which a removal hook
   * reads through `causeOf`. The mounted projections, the layer list and the scene of the world are not touched. Does
   * nothing without a build.
   *
   * @example
   * ```ts
   * // `scenes`: a restore aborted the node while the board was built.
   * const projection = ctx.require(worldPlugin).projection;
   * projection.discard();
   * projection.causeOf(1_048_600); // "discard", until the next sweep
   * projection.isBuilding(1_048_600); // false
   * ```
   */
  discard(): void;

  /**
   * Milliseconds of building budget left in this frame: the build's `budgetMs` minus the game clock time since the
   * frame started (read at the start of world's `input` phase). The clock counts whole milliseconds. Negative once
   * the frame spent more; `Infinity` with no build. Allocates nothing.
   *
   * @returns The milliseconds left, or `Infinity`.
   * @example
   * ```ts
   * // A renderer build step creates held views while the frame has budget, at least one a frame.
   * const projection = ctx.require(worldPlugin).projection;
   * projection.left(); // 3: 1 ms of the 4 ms budget is spent
   * projection.left(); // -1 after 4 ms more of views: the rest waits for the next frame
   * ```
   */
  left(): number;

  /**
   * Whether an entity belongs to the running build: a view it spawned, or an entity `adopt` marked. A view is flagged
   * before the `onAdded` hooks of its components, so a hook can ask. One set lookup; false with no build and after the
   * commit. Allocates nothing.
   *
   * @param entity - The entity to ask about.
   * @returns True for an entity of the running build.
   * @example
   * ```ts
   * // The renderer pass sorts the views of the coming scene out of its live work.
   * const projection = ctx.require(worldPlugin).projection;
   * projection.isBuilding(1_048_600); // true: a board item the build spawned
   * projection.isBuilding(1_048_576); // false: a ward bed on screen
   *
   * // A game plugin keeps one board root: the root of the board built aside is not a second one.
   * ctx.require(worldPlugin).ecs.onAdded(Tree, entity => {
   *   if (projection.isBuilding(entity)) return; // true for the board's root, built while the ward shows
   * });
   * ```
   */
  isBuilding(entity: Entity): boolean;

  /**
   * Registers one part of the build that has to be done before the swap: `built()` answers true only when every
   * registered check does. A registration stays across builds.
   *
   * @param check - Answers true when the caller's part of the running build is done.
   * @returns The remover; calling it twice is safe.
   * @example
   * ```ts
   * // The renderer, at start: its part is done when no building view waits for its Pixi object.
   * const off = ctx.require(worldPlugin).projection.onBuild(() => state.aside.count === 0);
   *
   * off(); // onStop: the renderer is gone
   * ```
   */
  onBuild(check: () => boolean): () => void;

  /**
   * Marks an entity another plugin spawned for a building root as building, so `isBuilding` answers for the whole
   * tree and `discard` despawns it with the rest. Does nothing with no build; the commit clears the mark with every
   * other.
   *
   * @param entity - The entity to mark.
   * @example
   * ```ts
   * // `ui` spawns an element of a building root and marks it right away.
   * const world = ctx.require(worldPlugin);
   * const button = world.ecs.spawn({ kind: "plugin", name: "ui" }, []);
   * world.projection.adopt(button);
   * world.projection.isBuilding(button); // true until the commit
   * ```
   */
  adopt(entity: Entity): void;
};

/**
 * projection methods the plugin root drives from the frame and the hooks. Not public.
 */
export type ProjectionInternal = {
  /**
   * Records a commit. In fast mode it reconciles at once, direct.
   *
   * @param roots - The state roots the commit touched.
   * @param cause - Why the commit happened.
   */
  markDirty(roots: readonly Root[], cause: Cause): void;

  /**
   * Reconciles when the world is dirty. Runs at the start of `time` phase `input`.
   */
  reconcileIfDirty(): void;

  /**
   * Records the moment a frame starts, for the budget `left()` counts down. Runs first in `time`
   * phase `input`, with the moment `Now` gets; a frame without a build only reads a field.
   *
   * @param now - The game clock at the start of the frame.
   */
  startFrame(now: number): void;

  /**
   * Empties the hint buffer. Runs once per frame, reconcile or not.
   */
  dropHints(): void;

  /**
   * Buffers one released hint.
   *
   * @param hint - The hint `flow.fx` released after a commit.
   */
  pushHint(hint: Hint): void;

  /**
   * Sweeps the views whose motions ended: the despawn queue, the convergence check and the
   * pending drops. Then it drops the rest pose and the registered key of every element whose
   * entity is gone, and starts the loop of every live view that owes one. It runs once per
   * frame and does nothing unless the world is live. The tracks themselves are advanced by the
   * driver.
   */
  sweep(): void;

  /**
   * Finishes every motion and flushes every despawn queue. Called when the mode turns `fast`.
   */
  flushAll(): void;

  /**
   * Drops the views of a projection whose owner despawned its entities.
   *
   * @param owner - The owner that left.
   */
  ownerLeft(owner: Owner): void;

  /**
   * Drops every view, track, mute and spec.
   */
  clear(): void;
};
