/**
 * @file world/ecs — one store per component type: registration, reads, writes and the two
 * structural hooks.
 */
import type { WorldCtx } from "../types";
import { forgetChanges, markChanged, unmarkChanged } from "./changes";
import { isAlive } from "./entities";
import { recordRemoval } from "./history";
import type {
  AnyComponent,
  AnyComponentType,
  AnyComponentValue,
  EcsState,
  Entity,
  QueryTerm,
  ResourceType,
  StructuralHook
} from "./types";

/**
 * Creates an empty component store. It lives in its own non-exported function because lint rule
 * L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty store, keyed by entity.
 */
function emptyStore(): Map<Entity, object | true> {
  return new Map();
}

/**
 * Normalises a caught value into an `Error`, so the log always gets one.
 *
 * @param error - What was thrown.
 * @returns The error, or one built from the thrown value.
 * @example
 * ```ts
 * asError("boom").message; // "boom"
 * ```
 */
export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Reads a registered type as a component whose value shape is erased to a plain record: what a
 * caller that knows the component only by its name can read and write. A tag stays honest, since
 * `get` answers `undefined` for the `true` it stores.
 *
 * @param componentType - The registered type, or nothing.
 * @returns The same object, typed for a record read.
 */
export function asComponent(componentType: AnyComponentType | undefined): AnyComponent | undefined {
  // The object is the callable type `component()` built; only its value shape is erased here.
  return componentType as AnyComponent | undefined;
}

/**
 * Reads the component type behind a query term, whether it is marked with `mut()` or not.
 *
 * @param term - One query term.
 * @returns The component or tag type.
 */
export function termType(term: QueryTerm): AnyComponentType {
  return "of" in term ? term.of : term;
}

/**
 * Registers a component type in the world on first use. A second type object with a known name is
 * a mistake in the game, not a rename.
 *
 * @param ctx - Domain context of the world plugin.
 * @param componentType - The type to register.
 * @throws {Error} When another object already holds that name.
 */
export function registerType(ctx: WorldCtx, componentType: AnyComponentType): void {
  const known = ctx.state.ecs.types.get(componentType.componentName);

  if (known === componentType) return;
  if (known !== undefined) {
    throw new Error(
      `[game] Component "${componentType.componentName}" is defined twice.\n` +
        "  Use one component() call and import it."
    );
  }

  ctx.state.ecs.types.set(componentType.componentName, componentType);
}

/**
 * The store of a type the world does not read through yet: the type is registered (a second
 * object of a known name throws), and its store, once one exists, is kept for the type object.
 *
 * @param ctx - Domain context of the world plugin.
 * @param componentType - The component or tag type.
 * @returns The store, or `undefined` while no entity carried the component.
 * @throws {Error} When another object already holds that name.
 */
function findStore(
  ctx: WorldCtx,
  componentType: AnyComponentType
): Map<Entity, object | true> | undefined {
  registerType(ctx, componentType);

  const store = ctx.state.ecs.stores.get(componentType.componentName);

  if (store !== undefined) ctx.state.ecs.typeStores.set(componentType, store);

  return store;
}

/**
 * The store of a component type, for the calls a game makes every frame: one lookup by the type
 * object once the type has a store. A type object found there passed `registerType`, so the
 * check of its name is not repeated.
 *
 * @param ctx - Domain context of the world plugin.
 * @param componentType - The component or tag type.
 * @returns The store, or `undefined` while no entity carried the component.
 * @throws {Error} When another object already holds that name.
 */
export function storeFor(
  ctx: WorldCtx,
  componentType: AnyComponentType
): Map<Entity, object | true> | undefined {
  return ctx.state.ecs.typeStores.get(componentType) ?? findStore(ctx, componentType);
}

/**
 * The store a write of a type the world does not read through yet goes to: the type is
 * registered, its store made when none exists, and kept for the type object.
 *
 * @param ctx - Domain context of the world plugin.
 * @param componentType - The component or tag type.
 * @returns The store.
 * @throws {Error} When another object already holds that name.
 */
function newStoreFor(ctx: WorldCtx, componentType: AnyComponentType): Map<Entity, object | true> {
  registerType(ctx, componentType);

  const store = storeOf(ctx.state.ecs, componentType.componentName);

  ctx.state.ecs.typeStores.set(componentType, store);

  return store;
}

/**
 * Returns the store of one component, creating it on first use.
 *
 * @param state - ecs module state.
 * @param name - Component name.
 * @returns The store, keyed by entity.
 */
function storeOf(state: EcsState, name: string): Map<Entity, object | true> {
  const store = state.stores.get(name) ?? emptyStore();

  state.stores.set(name, store);

  return store;
}

/**
 * Runs the listeners of one structural list. A throwing listener is logged and the next one still
 * runs, because a display object must not keep the world from changing.
 *
 * @param ctx - Domain context of the world plugin.
 * @param hooks - The listeners to call.
 * @param event - Which list it is, for the log entry.
 * @param entity - The entity that changed.
 * @param value - The stored value.
 */
function fire(
  ctx: WorldCtx,
  hooks: readonly StructuralHook[] | undefined,
  event: string,
  entity: Entity,
  value: unknown
): void {
  for (const hook of hooks ?? []) {
    try {
      hook(entity, value);
    } catch (error) {
      ctx.log.error(event, { entity }, asError(error));
    }
  }
}

/**
 * Writes a component value onto an entity. A replacing write marks the entity changed and fires
 * no `onAdded`.
 *
 * @param ctx - Domain context of the world plugin.
 * @param entity - The entity to write.
 * @param value - The component or tag value.
 */
export function attachComponent(ctx: WorldCtx, entity: Entity, value: AnyComponentValue): void {
  const state = ctx.state.ecs;
  const name = value.type.componentName;
  const store = state.typeStores.get(value.type) ?? newStoreFor(ctx, value.type);
  const had = store.has(entity);
  const stored = value.value === true ? true : { ...value.value };

  store.set(entity, stored);
  markChanged(state, name, entity);

  if (!had) fire(ctx, state.added.get(name), "world:added-hook-failed", entity, stored);
}

/**
 * Removes one component from an entity and fires `onRemoved` when it was there. The removal
 * leaves the change set of that component, so the frame history records it here.
 *
 * @param ctx - Domain context of the world plugin.
 * @param entity - The entity to write.
 * @param name - Component name.
 */
export function detachComponent(ctx: WorldCtx, entity: Entity, name: string): void {
  const state = ctx.state.ecs;
  const store = state.stores.get(name);

  if (store === undefined || !store.has(entity)) return;

  const value = store.get(entity);

  store.delete(entity);
  unmarkChanged(state, name, entity);
  recordRemoval(ctx, entity, name);
  fire(ctx, state.removed.get(name), "world:removed-hook-failed", entity, value);
}

/**
 * Removes every component of an entity, each firing `onRemoved`, and takes it out of every change
 * set.
 *
 * @param ctx - Domain context of the world plugin.
 * @param entity - The entity to clear.
 */
export function clearEntity(ctx: WorldCtx, entity: Entity): void {
  for (const name of ctx.state.ecs.stores.keys()) detachComponent(ctx, entity, name);
  forgetChanges(ctx.state.ecs, entity);
}

/**
 * Throws the error of a write to an entity that cannot take it: the stale id first, then the
 * missing component.
 *
 * @param state - ecs module state.
 * @param entity - The entity written.
 * @param name - Component name.
 * @throws {Error} Always: the entity is gone, or it carries no such component.
 */
function refuseWrite(state: EcsState, entity: Entity, name: string): never {
  if (!isAlive(state, entity)) {
    throw new Error(
      `[game] Entity ${entity} is gone, so "${name}" cannot be written.\n` +
        "  A stale id reads undefined; check ecs.has(entity, Component) first."
    );
  }

  throw new Error(
    `[game] Entity ${entity} carries no "${name}".\n  Add the component before writing it.`
  );
}

/**
 * Shallow-merges a patch into a stored component and marks the entity changed. A stored value
 * means the entity lives: a despawn takes every component away first.
 *
 * @param ctx - Domain context of the world plugin.
 * @param entity - The entity to write.
 * @param componentType - The component type.
 * @param patch - The fields to overwrite.
 * @throws {Error} When the entity is stale or does not carry the component.
 */
export function writeComponent(
  ctx: WorldCtx,
  entity: Entity,
  componentType: AnyComponentType,
  patch: object
): void {
  const state = ctx.state.ecs;
  const stored = storeFor(ctx, componentType)?.get(entity);

  if (stored === undefined || stored === true) {
    refuseWrite(state, entity, componentType.componentName);
  }

  // `Object.assign` and an own-key loop allocate the same, 16 B per double field read out of the
  // caller's patch (the box V8 makes for a generic read), 0 B for an integer field; the builtin is
  // faster on a patch of two fields or more (measured, 2026-10-18).
  Object.assign(stored, patch);
  markChanged(state, componentType.componentName, entity);
}

/**
 * The resource names the engine's plugins use, with what each one holds. A game resource of one
 * of these names would share the engine's value, so it is refused.
 */
const ENGINE_RESOURCES = {
  Now: "the frame's moment",
  Pointer: "the pointer of input",
  AnimPlayer: "the animation player of anim",
  UiCounters: "the layout counters of ui"
} as const;

/**
 * Tells whether a resource name is one of the engine's.
 *
 * @param name - The storage name of a resource.
 * @returns True for `"Now"`, `"Pointer"`, `"AnimPlayer"` and `"UiCounters"`.
 * @example
 * ```ts
 * isEngineName("Now"); // true
 * isEngineName("Clock"); // false
 * ```
 */
function isEngineName(name: string): name is keyof typeof ENGINE_RESOURCES {
  return Object.hasOwn(ENGINE_RESOURCES, name);
}

/**
 * Keeps an engine resource name to the type object first read under it: it records that type,
 * and refuses another one of the same name. Any other name passes.
 *
 * @param state - ecs module state.
 * @param resourceType - The resource type being read.
 */
function checkEngineName(state: EcsState, resourceType: ResourceType<object>): void {
  const name = resourceType.resourceName;

  if (!isEngineName(name)) return;

  const recorded = state.engineResources.get(name);

  if (recorded === undefined) state.engineResources.set(name, resourceType);
  else if (recorded !== resourceType) {
    throw new Error(
      `[game] world: the resource name "${name}" is the engine's (${ENGINE_RESOURCES[name]}).\n  Rename the game's resource.`
    );
  }
}

/**
 * Returns the one mutable value of a resource, made on first read: the factory default is called,
 * plain defaults are deep-cloned. The type stored first under an engine resource name is the only
 * one read under it; another type of that name throws.
 *
 * @param state - ecs module state.
 * @param resourceType - The resource type.
 * @returns The mutable resource value.
 */
export function resourceValue<Value extends object>(
  state: EcsState,
  resourceType: ResourceType<Value>
): Value {
  // Per call: one lookup by the type object; only a type's first read checks and makes.
  const kept = state.resourceSlots.get(resourceType);

  // The slot holds the value made for this very type object.
  return kept === undefined ? firstRead(state, resourceType) : (kept as Value);
}

/**
 * The first read of a resource type in a world: the engine name check, then the value under its
 * name, made when no type of that name made one yet. The value is kept for the type object.
 *
 * @param state - ecs module state.
 * @param resourceType - The resource type.
 * @returns The mutable resource value.
 * @throws {Error} When an engine resource name is read through another type object.
 */
function firstRead<Value extends object>(
  state: EcsState,
  resourceType: ResourceType<Value>
): Value {
  const name = resourceType.resourceName;

  checkEngineName(state, resourceType);

  // A resource of this name made by another type object of the same name is that value.
  const known = state.resources.get(name) as Value | undefined;
  const defaults = resourceType.defaults;
  const value =
    known ?? (typeof defaults === "function" ? defaults() : (structuredClone(defaults) as Value));

  state.resources.set(name, value);
  state.resourceSlots.set(resourceType, value);

  return value;
}

/**
 * Adds a listener to one of the structural lists and returns its remover.
 *
 * @param lists - `state.added` or `state.removed`.
 * @param name - Component name.
 * @param hook - The listener.
 * @returns The remover; calling it twice is a no-op.
 */
export function addHook(
  lists: Map<string, StructuralHook[]>,
  name: string,
  hook: StructuralHook
): () => void {
  const list = lists.get(name) ?? [];

  list.push(hook);
  lists.set(name, list);

  return (): void => {
    const at = list.indexOf(hook);

    if (at !== -1) list.splice(at, 1);
  };
}
