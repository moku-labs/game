/**
 * @file world/projection — type definitions: layers, projection specs, views, motion hooks,
 * the tween driver seam and the module API.
 */
import type { Hint } from "../../flow/types";
import type { Json, Root } from "../../model/types";
import type {
  AnyComponent,
  AnyComponentValue,
  ComponentType,
  EcsApi,
  EcsInternal,
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
 * One named layer of a scene. The order of the list is draw order.
 *
 * @example
 * ```ts
 * const layer: LayerSpec = { name: "items", sort: "y" };
 * ```
 */
export type LayerSpec = { name: string; sort: LayerSort };

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
 * counts the extra runs, `"forever"` never ends. The world passes it to the driver unchanged;
 * without a driver the target is written once.
 *
 * @example
 * ```ts
 * const options: TweenOptions = { ms: 350, ease: "out", delayMs: 40 };
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
};

/**
 * Options of `ViewHandle.toRest`. Defaults: the plugin's `settleMs` and ease `"out"`. `delayMs`
 * lets a hook wait, for example for a flight to land, before the view comes home.
 *
 * @example
 * ```ts
 * const options: RestOptions = { ms: 200, delayMs: 120 };
 * ```
 */
export type RestOptions = { ms?: number; ease?: Ease; delayMs?: number };

/**
 * What the driver is told about one track: how long it runs, how it eases, how long it waits,
 * whether it adds to the field or owns it, and the keyframe segments it walks. A track with
 * segments walks them over `ms` on one clock and claims every field a segment names; its target
 * `to` is the last segment's target. A track with `repeat` starts its walk again when it ends
 * (a number counts the extra runs, `"forever"` never ends); the instant driver ignores it and
 * writes the end pose once.
 *
 * @example
 * ```ts
 * const options: TrackOptions = { ms: 250, ease: "outBack", delayMs: 0, additive: false };
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
};

/**
 * The tween engine behind `ViewHandle.tween`, `toRest` and `all`. `anim` installs one with
 * `setDriver`; without it the world writes every target at once.
 *
 * A track reads its start values when its delay ends, writes the exact target on its last frame
 * and goes through `ecs.set`, so `changed()` sees it. Muted fields are never written, also not on
 * `finish()`.
 *
 * @example
 * ```ts
 * // `anim` hands the world its own tween core in `onStart`.
 * const driver: TweenDriver = { track: startTrack, cancelAll: cancelTracksOf };
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
 * other motions, so a change never cancels it; it ends when the view dies.
 *
 * @example
 * ```ts
 * const motion: ProjectionMotion<Item> = {
 *   change: { Transform: view => view.toRest(Transform, { ms: 350 }) }
 * };
 * // An order card that sways forever once it entered.
 * const swaying: ProjectionMotion<Item> = {
 *   loop: view =>
 *     view.tween(Transform, { rotation: 0.05 }, { ms: 1200, additive: true, repeat: "forever" })
 * };
 * ```
 */
export type ProjectionMotion<Item> = {
  enter?(view: ViewHandle<Item>, item: Item, hint?: Hint): Motion;
  loop?(view: ViewHandle<Item>): Motion;
  exit?(view: ViewHandle<Item>, item: Item, hint?: Hint): Motion;
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
  enter?(view: ViewHandle<unknown>, item: unknown, hint?: Hint): Motion;
  loop?(view: ViewHandle<unknown>): Motion;
  exit?(view: ViewHandle<unknown>, item: unknown, hint?: Hint): Motion;
  readonly change?: ChangeHooks<never>;
  settle?(view: ViewHandle<unknown>, components: readonly string[]): Motion;
};

/**
 * One projection: keyed items of the model turned into entities. `Item` is inferred from the
 * return of `from`; `layer` and `lift` keep their literal types so a scene can check them.
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
  Session
> = {
  readonly name: string;
  readonly layer: LayerName;
  readonly lift?: LiftName;
  from(player: Player, session: Session): readonly Item[] | Item;
  /** Omitted when `from` returns one plain object: the key is then the name of the projection. */
  key?(item: Item): string;
  view(item: Item): ViewOutput;
  readonly motion?: ProjectionMotion<Item>;
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
};

/**
 * Why a reconcile runs. Merged over the frame; the cause table decides play or direct.
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
 *
 * @example
 * ```ts
 * const view: View = {
 *   entity: 1_048_576,
 *   projection: "board.items",
 *   key: "i7",
 *   item: { id: "i7" },
 *   rest: new Map(),
 *   handles: [],
 *   lifted: false,
 *   dropWhenStill: false,
 *   exiting: false
 * };
 * ```
 */
export type View = {
  entity: Entity;
  projection: string;
  key: string;
  item: unknown;
  /** The last output of `view(item)`, by component name: what the picture equals at rest. */
  rest: Map<string, AnyComponentValue>;
  handles: MotionHandle[];
  lifted: boolean;
  /** `lift(false)` is waiting for the last motion to end. */
  dropWhenStill: boolean;
  exiting: boolean;
};

/**
 * One mounted projection: its owner, the live views by key, the despawn queue and the items of
 * the last reconcile.
 *
 * @example
 * ```ts
 * const mounted: Mounted = {
 *   owner: { kind: "projection", name: "board.items" },
 *   live: new Map(),
 *   queue: [],
 *   items: new Map()
 * };
 * ```
 */
export type Mounted = {
  owner: Owner;
  live: Map<string, View>;
  queue: View[];
  items: Map<string, unknown>;
};

/**
 * One track the projection started on the driver. The world keeps the component name and the
 * handle, so it knows which components are driven without knowing how the driver runs them.
 *
 * @example
 * ```ts
 * const track: Track = { entity: 1_048_576, component: "Transform", handle: flight };
 * track.handle.active(); // true while the flight runs
 * ```
 */
export type Track = { entity: Entity; component: string; handle: MotionHandle };

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
  /** The rest pose of an entity that is not a view, recorded by its owner through `setRest`. */
  rests: Map<Entity, RestPose>;
  /** Projection name to key to the entity a plugin above registered under it. */
  keys: Map<string, Map<string, Entity>>;
  /** The reverse of `keys`, so `keyOf` answers for a registered element too. */
  keysByEntity: Map<Entity, ProjectionKey>;
  /** Entity to component name to the fields another writer owns. */
  mutes: Map<Entity, Map<string, Set<string>>>;
  offHints: Array<() => void>;
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
  ecsInternal: EcsInternal;
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
 *
 * @example
 * ```ts
 * const options: ReconcileOptions = { direct: true, force: false };
 * ```
 */
export type ReconcileOptions = {
  names?: readonly string[];
  direct: boolean;
  force: boolean;
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
   * its own transition. Nothing is mounted when the call throws.
   *
   * @param names - Names of the projections to mount.
   * @param owner - Who owns the entities of these projections.
   * @throws {Error} For an unknown name, or a `layer` or `lift` the scene does not declare.
   * @example
   * ```ts
   * // `scenes` mounts the projections of the board scene it just switched to.
   * const world = ctx.require(worldPlugin);
   * world.projection.mount(["board.cells", "board.items"], { kind: "plugin", name: "scenes" });
   * world.projection.entityOf("board.items", "i7"); // 1048576, the picture is already there
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
   * In mode `paused` or `fast` the rest pose is written at once. No-op for an entity that is not
   * a live view.
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
   * Hands a set of fields to another writer. Tracks never write them, also not on `finish()`.
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
   * board until it is home.
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
   * element registered with `registerKey`.
   *
   * @param entity - The entity to ask about.
   * @returns The projection name and the key, or `undefined`.
   * @example
   * ```ts
   * // `renderer.sync` labels its display objects for the inspector.
   * app.world.projection.keyOf(1_048_576); // { projection: "board.items", key: "i7" }
   * app.world.projection.keyOf(42); // undefined: not a view
   * ```
   */
  keyOf(entity: Entity): ProjectionKey | undefined;

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
   * plays its exit is left out, and so is an element registered with `registerKey`. Every call
   * hands out a new array.
   *
   * @param name - Name of the projection.
   * @returns The entities, or `[]` when the projection is not mounted.
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
   * Marks every mounted projection dirty and forces `view` for every item, so the next frame
   * rebuilds the picture directly.
   *
   * @example
   * ```ts
   * // `i18n` switched the locale: every label has to be projected again.
   * const world = ctx.require(worldPlugin);
   * world.projection.rerunAll(); // the next frame writes the new strings with no motion
   * ```
   */
  rerunAll(): void;
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
   * pending drops. The tracks themselves are advanced by the driver.
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
