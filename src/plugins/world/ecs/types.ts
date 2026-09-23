/**
 * @file world/ecs — type definitions: entities, component types, queries, systems and the module API.
 */
import type { Json, Snapshot } from "../../model/types";
import type { Time } from "../../time/types";

/**
 * Entity id: `generation * 2 ** 20 + index`, a safe integer. A freed index comes back with a
 * higher generation, so an id is never silently reused.
 *
 * @example
 * ```ts
 * const entity: Entity = 1_048_576; // generation 1, index 0
 * ```
 */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- the spec names Entity: it is the contract every plugin above reads
export type Entity = number;

/**
 * Who owns an entity. Every `spawn` names one, so `despawnOwnedBy` can free exactly one owner's
 * entities and `snapshot()` can say where an entity came from.
 *
 * @example
 * ```ts
 * const owner: Owner = { kind: "projection", name: "board.items" };
 * ```
 */
export type Owner = { kind: "projection" | "node" | "plugin"; name: string };

/**
 * The four phases systems run in, in frame order.
 *
 * @example
 * ```ts
 * const phase: WorldPhase = "animate";
 * ```
 */
export type WorldPhase = "input" | "animate" | "layout" | "sync";

/**
 * World mode. `"paused"` and `"fast"` skip the phases `input`, `animate` and `layout`; phase
 * `sync` runs in every mode.
 *
 * @example
 * ```ts
 * const mode: WorldMode = "fast";
 * ```
 */
export type WorldMode = "live" | "paused" | "fast";

/**
 * One component value ready to be written: the storage key and the frozen data.
 *
 * @example
 * ```ts
 * const value: ComponentValue<{ level: number }> = { type: Item, value: { level: 2 } };
 * ```
 */
export type ComponentValue<Value extends object> = {
  readonly type: ComponentType<Value>;
  readonly value: Readonly<Value>;
};

/**
 * A tag value. A tag carries no data and is stored as `true`.
 *
 * @example
 * ```ts
 * const held: TagValue = { type: Held, value: true };
 * ```
 */
export type TagValue = { readonly type: TagType; readonly value: true };

/**
 * Any component or tag value, as `spawn` and `view` return them.
 *
 * @example
 * ```ts
 * const values: AnyComponentValue[] = [Held()];
 * ```
 */
export type AnyComponentValue = { readonly type: AnyComponentType; readonly value: object | true };

/**
 * A component type whose value shape is erased to a plain record: what the projection writes when
 * it only knows the component by name.
 *
 * @example
 * ```ts
 * const erased: AnyComponent = component("Transform", { x: 0, y: 0 }) as AnyComponent;
 * erased.componentName; // "Transform"
 * ```
 */
export type AnyComponent = ComponentType<Record<string, unknown>>;

/**
 * A component type made by `component()`: callable to build a value, and carrying the storage
 * name plus the defaults that give the TypeScript type, the JSON shape and the inspector schema.
 *
 * @example
 * ```ts
 * const Item: ComponentType<{ kind: string; level: number }> = component("Item", {
 *   kind: "",
 *   level: 1
 * });
 * Item({ level: 2 }); // { type: Item, value: { kind: "", level: 2 } }
 * Item.owned; // []: a projection view writes every field
 * ```
 */
export type ComponentType<Value extends object> = {
  (patch?: Partial<Value>): ComponentValue<Value>;
  readonly componentName: string;
  readonly defaults: Readonly<Value>;
  readonly kind: "component";
  /** Fields a plugin writes and a projection view never does, so a view never corrects them. */
  readonly owned: readonly string[];
};

/**
 * A tag type made by `tag()`: a component with no data.
 *
 * @example
 * ```ts
 * const Held: TagType = tag("Held");
 * Held(); // { type: Held, value: true }
 * ```
 */
export type TagType = {
  (): TagValue;
  readonly componentName: string;
  readonly kind: "tag";
};

/**
 * What the world stores about a component or tag type, independent of its data type.
 *
 * @example
 * ```ts
 * const registered: AnyComponentType = { componentName: "Held", kind: "tag" };
 * ```
 */
export type AnyComponentType = {
  readonly componentName: string;
  readonly kind: "component" | "tag";
};

/**
 * What the ECS needs from a component type to read and write its store: the name and the
 * defaults, never the call signature. A component bound to a game's keys by a `…For` binder
 * (`Narrowed`) is the same object with a narrower call, so it passes here unchanged.
 *
 * @example
 * ```ts
 * const ref: ComponentHandle<{ x: number }> = component("Pos", { x: 0 });
 * ref.defaults; // { x: 0 }
 * ```
 */
export type ComponentHandle<Value extends object> = {
  readonly componentName: string;
  readonly defaults: Readonly<Value>;
  readonly kind: "component";
};

/**
 * A component type whose call signature takes a narrower patch: the same object, the same
 * store, the compiler refuses what the game's generated keys do not know.
 *
 * @example
 * ```ts
 * const Sprite: Narrowed<{ texture: string }, { texture?: "board.cell" }> = component("Sprite", { texture: "" });
 * Sprite({ texture: "board.cell" }).value.texture; // "board.cell"
 * ```
 */
export type Narrowed<Value extends object, Patch> = Omit<ComponentType<Value>, never> &
  ((patch?: Patch) => ComponentValue<Value>);

/**
 * A resource type made by `resource()`: one mutable object per world, created from a deep clone
 * of the defaults on first read.
 *
 * @example
 * ```ts
 * const Pointer: ResourceType<{ x: number; y: number }> = resource("Pointer", { x: 0, y: 0 });
 * Pointer.resourceName; // "Pointer"
 * ```
 */
export type ResourceType<Value extends object> = {
  readonly resourceName: string;
  readonly defaults: Readonly<Value>;
};

/**
 * A query term marked as written by `mut()`. Its only effect is change detection.
 *
 * @example
 * ```ts
 * const written: Mut<{ x: number }> = mut(Transform);
 * written.kind; // "mut"
 * ```
 */
export type Mut<Value extends object> = {
  readonly kind: "mut";
  readonly of: ComponentHandle<Value>;
};

/**
 * A `mut()` term with its data type erased, as the world stores it.
 *
 * @example
 * ```ts
 * const term: AnyMut = { kind: "mut", of: { componentName: "Transform", kind: "component" } };
 * ```
 */
export type AnyMut = { readonly kind: "mut"; readonly of: AnyComponentType };

/**
 * One term of a query: a component type, a tag type, or a `mut()` of a component type.
 *
 * @example
 * ```ts
 * const terms: QueryTerm[] = [mut(Transform), Sprite, Held];
 * ```
 */
export type QueryTerm = AnyComponentType | AnyMut;

/**
 * The value a query yields for one term: writable for `mut()`, `true` for a tag, read-only for a
 * plain component.
 *
 * @example
 * ```ts
 * type Written = ValueOf<Mut<{ x: number }>>; // { x: number }
 * ```
 */
export type ValueOf<Term> =
  Term extends Mut<infer Value>
    ? Value
    : Term extends TagType
      ? true
      : Term extends ComponentHandle<infer Value>
        ? Readonly<Value>
        : never;

/**
 * The value part of a query row, one entry per term, in term order.
 *
 * @example
 * ```ts
 * type Values = QueryValues<[TagType]>; // [true]
 * ```
 */
export type QueryValues<Terms extends readonly QueryTerm[]> = {
  -readonly [Index in keyof Terms]: ValueOf<Terms[Index]>;
};

/**
 * One row a query yields: the entity, then one value per term.
 *
 * @example
 * ```ts
 * type Row = QueryTuple<[ComponentType<{ x: number }>]>; // [Entity, Readonly<{ x: number }>]
 * ```
 */
export type QueryTuple<Terms extends readonly QueryTerm[]> = [Entity, ...QueryValues<Terms>];

/**
 * What a system receives next to its entities: the world, the mutable resources, the frozen model
 * snapshot of the frame and the frame's `Time`. A system may read pure game rules; it never
 * writes the model.
 *
 * @example
 * ```ts
 * const run = (entities: Iterable<[Entity]>, ctx: SystemContext): void => {
 *   ctx.res(Pointer).x = 0;
 *   ctx.time.delta; // 16
 * };
 * ```
 */
export type SystemContext = {
  readonly world: EcsApi;
  res<Value extends object>(resource: ResourceType<Value>): Value;
  readonly snapshot: Snapshot;
  readonly time: Readonly<Time>;
};

/**
 * A system definition, typed over its query tuple.
 *
 * @example
 * ```ts
 * const bob: SystemDefinition<[ComponentType<{ y: number }>]> = {
 *   name: "bob",
 *   phase: "animate",
 *   query: [Transform],
 *   run: entities => {
 *     for (const [, transform] of entities) transform.y; // read-only
 *   }
 * };
 * ```
 */
export type SystemDefinition<Terms extends readonly QueryTerm[]> = {
  readonly name: string;
  readonly phase: WorldPhase;
  readonly query: Terms;
  run(entities: Iterable<QueryTuple<Terms>>, ctx: SystemContext): void;
};

/**
 * A system with its query tuple erased, as the world stores it.
 *
 * @example
 * ```ts
 * const entry: AnySystem = { name: "bob", phase: "animate", query: [], run: () => {} };
 * ```
 */
export type AnySystem = {
  readonly name: string;
  readonly phase: WorldPhase;
  readonly query: readonly QueryTerm[];
  run(entities: Iterable<readonly unknown[]>, ctx: SystemContext): void;
};

/**
 * One registered system and the frame it was registered in. A system registered during a frame
 * runs from the next frame on.
 *
 * @example
 * ```ts
 * const entry: SystemEntry = { definition: bobSystem, frame: 12 };
 * ```
 */
export type SystemEntry = { readonly definition: AnySystem; readonly frame: number };

/**
 * A structural change queued while a phase runs. Applied in call order when the phase ends.
 *
 * @example
 * ```ts
 * const command: Command = { kind: "remove", entity: 1_048_576, component: "Held" };
 * ```
 */
export type Command =
  | { kind: "attach"; entity: Entity; components: readonly AnyComponentValue[] }
  | { kind: "despawn"; entity: Entity }
  | { kind: "despawnOwnedBy"; owner: Owner }
  | { kind: "add"; entity: Entity; value: AnyComponentValue }
  | { kind: "remove"; entity: Entity; component: string };

/**
 * A structural listener registered with `onAdded` or `onRemoved`.
 *
 * @example
 * ```ts
 * const hook: StructuralHook = (entity, value) => void entity + String(value);
 * ```
 */
export type StructuralHook = (entity: Entity, value: unknown) => void;

/**
 * The frozen model snapshot of one frame, kept so four phases read it once.
 *
 * @example
 * ```ts
 * const cached: FrameSnapshot = { frame: 12, snapshot: { player: {}, session: {}, rng: rngState } };
 * ```
 */
export type FrameSnapshot = { frame: number; snapshot: Snapshot };

/**
 * ecs module state.
 */
export type EcsState = {
  generations: number[];
  free: number[];
  owners: Map<Entity, Owner>;
  /** Key is `"kind:name"` of the owner. */
  byOwner: Map<string, Set<Entity>>;
  types: Map<string, AnyComponentType>;
  stores: Map<string, Map<Entity, object | true>>;
  resources: Map<string, object>;
  systems: Record<WorldPhase, SystemEntry[]>;
  running: WorldPhase | undefined;
  commands: Command[];
  changed: Map<string, Set<Entity>>;
  added: Map<string, StructuralHook[]>;
  removed: Map<string, StructuralHook[]>;
  ownerLeft: Array<(owner: Owner) => void>;
  mode: WorldMode;
  offFrame: Array<() => void>;
  frameSnapshot: FrameSnapshot | undefined;
};

/**
 * ecs module API, `app.world.ecs`: the screen as data. Plain-object components in one store per
 * component type, generational entity ids, a mandatory owner, a command buffer applied between
 * phases, coarse change detection and fixed phases driven by `time`.
 *
 * @example
 * ```ts
 * // A test owns its entities and reads them back.
 * const entity = app.world.ecs.spawn({ kind: "plugin", name: "test" }, [Transform({ x: 10 })]);
 * app.world.ecs.get(entity, Transform); // { x: 10, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }
 * ```
 */
export type EcsApi = {
  /**
   * Registers a system at the end of its phase list. A system registered during a frame runs
   * from the next frame on.
   *
   * @param definition - The system, built with `system()`.
   * @returns The remover; calling it twice is a no-op.
   * @throws {Error} When a system of that name is already registered.
   * @example
   * ```ts
   * // `text` registers its layout system when the plugin starts.
   * const world = ctx.require(worldPlugin);
   * const off = world.ecs.system(measureLabels); // runs from the next frame
   *
   * off(); // the plugin stops
   * ```
   */
  system(definition: AnySystem): () => void;

  /**
   * Creates an entity. The id is reserved and returned at once, also inside a phase, where the
   * components are attached when the phase ends.
   *
   * @param owner - Who owns the entity. Required by the type.
   * @param components - Component and tag values the entity starts with.
   * @returns The new entity id.
   * @example
   * ```ts
   * // `ui` spawns a popup entity it owns, so closing the node frees it in one call.
   * const entity = app.world.ecs.spawn({ kind: "node", name: "reward" }, [
   *   Transform({ x: 540, y: 960 })
   * ]);
   * app.world.ecs.has(entity, Transform); // true
   * ```
   */
  spawn(owner: Owner, components: readonly AnyComponentValue[]): Entity;

  /**
   * Removes every component of an entity, each firing `onRemoved`, frees the index and bumps the
   * generation. A stale id is a no-op.
   *
   * @param entity - The entity to remove.
   * @example
   * ```ts
   * // `ui` closes the popup it spawned. Asking again answers with the empty world.
   * app.world.ecs.despawn(popup);
   * app.world.ecs.has(popup, Transform); // false
   * ```
   */
  despawn(entity: Entity): void;

  /**
   * Despawns exactly the entities of one owner and tells `projection` that the owner left.
   *
   * @param owner - The owner whose entities go.
   * @example
   * ```ts
   * // A test cleans up after itself without touching the projections of the game.
   * app.world.ecs.despawnOwnedBy({ kind: "plugin", name: "test" });
   * app.world.ecs.snapshot(); // { mode: "live", entities: [], resources: {} }
   * ```
   */
  despawnOwnedBy(owner: Owner): void;

  /**
   * Reads a component value. A stale id or a missing component gives `undefined`.
   *
   * @param entity - The entity to read.
   * @param component - The component type.
   * @returns The stored value, read-only, or `undefined`.
   * @example
   * ```ts
   * // `input` asks whether the entity under the finger may be dragged.
   * const world = ctx.require(worldPlugin);
   * world.ecs.get(hit, Draggable); // { payload: { id: "i7" } }
   * world.ecs.get(hit, DropTarget); // undefined: this item takes no drop
   * ```
   */
  get<Value extends object>(
    entity: Entity,
    component: ComponentHandle<Value>
  ): Readonly<Value> | undefined;

  /**
   * Shallow-merges a patch into a stored component and marks the entity changed for it. Never
   * queued: a `set` inside a phase is visible to the next system of that phase.
   *
   * @param entity - The entity to write.
   * @param component - The component type.
   * @param patch - The fields to overwrite.
   * @throws {Error} When the entity is stale or does not carry the component.
   * @example
   * ```ts
   * // `input` moves the held view with the finger.
   * const world = ctx.require(worldPlugin);
   * world.ecs.set(held, Transform, { x: 420, y: 810 });
   * world.ecs.get(held, Transform); // { x: 420, y: 810, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }
   * ```
   */
  set<Value extends object>(
    entity: Entity,
    component: ComponentHandle<Value>,
    patch: Partial<Value>
  ): void;

  /**
   * Adds a component value. On an entity that already carries it the value is replaced and the
   * entity is marked changed; no `onAdded` fires.
   *
   * @param entity - The entity to write.
   * @param value - The component or tag value, built by calling its type.
   * @example
   * ```ts
   * // `text` gives the label entity its display object once the atlas is there.
   * const world = ctx.require(worldPlugin);
   * world.ecs.add(label, Display({ object: bitmapText }));
   * world.ecs.has(label, Display); // true
   * ```
   */
  add(entity: Entity, value: AnyComponentValue): void;

  /**
   * Removes a component. Fires `onRemoved` when the entity carried it.
   *
   * @param entity - The entity to write.
   * @param component - The component or tag type to drop.
   * @example
   * ```ts
   * // `text` drops the display object when the label leaves the screen.
   * const world = ctx.require(worldPlugin);
   * world.ecs.remove(label, Display);
   * world.ecs.has(label, Display); // false
   * ```
   */
  remove(entity: Entity, component: AnyComponentType): void;

  /**
   * Tells whether an entity carries a component or tag. False for a stale id.
   *
   * @param entity - The entity to read.
   * @param component - The component or tag type.
   * @returns True when the entity carries it.
   * @example
   * ```ts
   * // `input` never hit-tests a view that is on its way out.
   * const world = ctx.require(worldPlugin);
   * world.ecs.has(candidate, Exiting); // true while the merge animation plays
   * ```
   */
  has(entity: Entity, component: AnyComponentType): boolean;

  /**
   * Adds a tag. Structural and idempotent.
   *
   * @param entity - The entity to write.
   * @param tagType - The tag type.
   * @example
   * ```ts
   * // `input` marks the view under the finger while the drag runs.
   * const world = ctx.require(worldPlugin);
   * world.ecs.tag(dragged, Held);
   * world.ecs.has(dragged, Held); // true
   * ```
   */
  tag(entity: Entity, tagType: TagType): void;

  /**
   * Removes a tag. Structural and idempotent.
   *
   * @param entity - The entity to write.
   * @param tagType - The tag type.
   * @example
   * ```ts
   * // `input` releases the view on pointer up.
   * const world = ctx.require(worldPlugin);
   * world.ecs.untag(dragged, Held);
   * world.ecs.has(dragged, Held); // false
   * ```
   */
  untag(entity: Entity, tagType: TagType): void;

  /**
   * Walks the store of the FIRST term in insertion order and keeps the entities that carry every
   * term. Deterministic. A `mut()` term marks every yielded entity changed for that component.
   *
   * @param terms - Component types, tag types and `mut()` terms.
   * @returns The matching rows: the entity and one value per term.
   * @example
   * ```ts
   * // `renderer.sync` walks every sprite that has a place on the screen.
   * for (const [entity, sprite, transform] of app.world.ecs.query(Sprite, Transform)) {
   *   display.get(entity)?.position.set(transform.x, transform.y);
   *   sprite.texture; // "board.item-red-1"
   * }
   * ```
   */
  query<const Terms extends readonly QueryTerm[]>(...terms: Terms): Iterable<QueryTuple<Terms>>;

  /**
   * Returns the one mutable value of a resource, created from a deep clone of its defaults on
   * first read.
   *
   * @param resourceType - The resource type.
   * @returns The mutable resource value.
   * @example
   * ```ts
   * // `input` writes the pointer once per frame; every game system reads the same object.
   * const world = ctx.require(worldPlugin);
   * const pointer = world.ecs.resource(Pointer);
   * pointer.down = true;
   * ```
   */
  resource<Value extends object>(resourceType: ResourceType<Value>): Value;

  /**
   * Registers a listener for the moment a component is added, called when the structural change
   * is applied. A throwing listener is logged and the others still run.
   *
   * @param component - The component type to watch.
   * @param fn - Called with the entity and the stored value.
   * @returns The remover; calling it twice is a no-op.
   * @example
   * ```ts
   * // `renderer.sync` creates a Pixi object for every new sprite.
   * const world = ctx.require(worldPlugin);
   * const off = world.ecs.onAdded(Sprite, (entity, sprite) => {
   *   objects.set(entity, makeSprite(sprite.texture));
   * });
   *
   * off(); // the renderer stops
   * ```
   */
  onAdded<Value extends object>(
    component: ComponentHandle<Value>,
    fn: (entity: Entity, value: Readonly<Value>) => void
  ): () => void;

  /**
   * Registers a listener for the moment a tag is added: `tag` on an entity without it, or a spawn
   * that carries it. A tag has no value, so the listener gets the entity only.
   *
   * @param tagType - The tag type to watch.
   * @param fn - Called with the entity that got the tag.
   * @returns The remover; calling it twice is a no-op.
   * @example
   * ```ts
   * // `ui` shows the pressed look while `input` holds the `Pressed` tag on a button.
   * const world = ctx.require(worldPlugin);
   * const off = world.ecs.onAdded(Pressed, entity => markPointer(entity, "pressed", true));
   *
   * world.ecs.tag(button, Pressed); // markPointer(button, "pressed", true)
   * off(); // ui stops
   * ```
   */
  onAdded(tagType: TagType, fn: (entity: Entity) => void): () => void;

  /**
   * Registers a listener for the moment a component is removed.
   *
   * @param component - The component type to watch.
   * @param fn - Called with the entity and the value it had.
   * @returns The remover; calling it twice is a no-op.
   * @example
   * ```ts
   * // `renderer.sync` destroys the Pixi object of a sprite that left.
   * const world = ctx.require(worldPlugin);
   * const off = world.ecs.onRemoved(Sprite, entity => {
   *   objects.get(entity)?.destroy();
   *   objects.delete(entity);
   * });
   *
   * off(); // the renderer stops
   * ```
   */
  onRemoved<Value extends object>(
    component: ComponentHandle<Value>,
    fn: (entity: Entity, value: Readonly<Value>) => void
  ): () => void;

  /**
   * Registers a listener for the moment a tag is removed: `untag` on an entity that had it, or a
   * despawn. The listener gets the entity only.
   *
   * @param tagType - The tag type to watch.
   * @param fn - Called with the entity that lost the tag.
   * @returns The remover; calling it twice is a no-op.
   * @example
   * ```ts
   * // `ui` drops the pressed look when `input` releases the button.
   * const world = ctx.require(worldPlugin);
   * const off = world.ecs.onRemoved(Pressed, entity => markPointer(entity, "pressed", false));
   *
   * world.ecs.untag(button, Pressed); // markPointer(button, "pressed", false)
   * off(); // ui stops
   * ```
   */
  onRemoved(tagType: TagType, fn: (entity: Entity) => void): () => void;

  /**
   * The coarse change set of the frame, cleared in `time` phase `signals` after every `sync`
   * system ran.
   *
   * @param component - The component type to ask about.
   * @returns The entities marked changed for it this frame.
   * @example
   * ```ts
   * // `renderer.sync` moves only what moved.
   * for (const entity of app.world.ecs.changed(Transform)) {
   *   const transform = app.world.ecs.get(entity, Transform);
   *   display.get(entity)?.position.set(transform?.x ?? 0, transform?.y ?? 0);
   * }
   * ```
   */
  changed(component: AnyComponentType): Iterable<Entity>;

  /**
   * The effective mode: `"fast"` while the flow walks fast, otherwise the stored one.
   *
   * @returns The mode the frame runs in.
   * @example
   * ```ts
   * // A test checks that a fast walk froze the tweens.
   * app.flow.setMode("fast");
   * app.world.ecs.mode(); // "fast", even though setMode was never called on the world
   * ```
   */
  mode(): WorldMode;

  /**
   * Stores the world mode. `"fast"` finishes every motion and flushes every despawn queue at once.
   *
   * @param mode - The new stored mode.
   * @example
   * ```ts
   * // A headless test wants the final picture without stepping frames.
   * app.world.ecs.setMode("fast");
   * app.world.ecs.mode(); // "fast"
   * ```
   */
  setMode(mode: WorldMode): void;

  /**
   * The component type behind a name. A type registers itself on first use, so a name nobody
   * wrote, read or queried yet is unknown.
   *
   * @param name - The storage name of the component.
   * @returns The type, or `undefined` when the world never met it.
   * @example
   * ```ts
   * // `text` resolves the component a label binds its number to.
   * const world = ctx.require(worldPlugin);
   * const type = world.ecs.typeOf("Coins"); // the Coins component, registered when it was written
   * const pose = type === undefined ? undefined : world.ecs.get(counter, type);
   *
   * pose?.amount; // 120
   * ```
   */
  typeOf(name: string): AnyComponent | undefined;

  /**
   * The whole world as plain JSON, sorted by entity index. A component value that is not JSON is
   * left out and its name is listed in `skipped`.
   *
   * @returns The world as JSON.
   * @example
   * ```ts
   * // A test asserts what the board holds after the first reconcile.
   * app.world.ecs.snapshot();
   * // { mode: "live", entities: [{ id: 1048576, index: 0, generation: 1,
   * //   owner: { kind: "projection", name: "board.items" },
   * //   components: { Layer: { name: "items" } }, skipped: [] }], resources: {} }
   * ```
   */
  snapshot(): Json;
};

/**
 * ecs methods injected into `projection`. Not public.
 */
export type EcsInternal = {
  /**
   * Registers a listener for `despawnOwnedBy`, so `projection` can drop the views of an owner
   * that left.
   *
   * @param fn - Called with the owner whose entities were despawned.
   * @returns The remover.
   */
  onOwnerLeft(fn: (owner: Owner) => void): () => void;

  /**
   * The owner of an entity, which is also the liveness check: a stale id has none. `projection`
   * asks before it hands out a view handle for an entity another plugin owns.
   *
   * @param entity - The entity to ask about.
   * @returns The owner, or `undefined` when the id is stale.
   */
  ownerOf(entity: Entity): Owner | undefined;

  /**
   * Runs the systems of one phase, then flushes the command buffer.
   *
   * @param phase - The phase to run.
   * @param time - The frame's `Time`.
   */
  runPhase(phase: WorldPhase, time: Readonly<Time>): void;

  /**
   * Applies the queued structural commands in call order.
   */
  flush(): void;

  /**
   * Clears every change set. Called in `time` phase `signals`.
   */
  clearChanges(): void;

  /**
   * Drops every entity, component, resource, system and hook.
   */
  clear(): void;
};
