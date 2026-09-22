/**
 * @file world/ecs — one store per component type: registration, reads, writes and the two
 * structural hooks.
 */
import type { WorldCtx } from "../types";
import { forgetChanges, markChanged } from "./changes";
import { isAlive } from "./entities";
import type {
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
 * Returns the store of one component, creating it on first use.
 *
 * @param state - ecs module state.
 * @param name - Component name.
 * @returns The store, keyed by entity.
 */
export function storeOf(state: EcsState, name: string): Map<Entity, object | true> {
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
  registerType(ctx, value.type);

  const state = ctx.state.ecs;
  const name = value.type.componentName;
  const store = storeOf(state, name);
  const had = store.has(entity);
  const stored = value.value === true ? true : { ...value.value };

  store.set(entity, stored);
  markChanged(state, name, entity);

  if (!had) fire(ctx, state.added.get(name), "world:added-hook-failed", entity, stored);
}

/**
 * Removes one component from an entity and fires `onRemoved` when it was there.
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
  state.changed.get(name)?.delete(entity);
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
 * Reads the stored value of one component.
 *
 * @param state - ecs module state.
 * @param entity - The entity to read.
 * @param name - Component name.
 * @returns The stored value, or `undefined`.
 */
export function readComponent(
  state: EcsState,
  entity: Entity,
  name: string
): object | true | undefined {
  return state.stores.get(name)?.get(entity);
}

/**
 * Shallow-merges a patch into a stored component and marks the entity changed.
 *
 * @param ctx - Domain context of the world plugin.
 * @param entity - The entity to write.
 * @param name - Component name.
 * @param patch - The fields to overwrite.
 * @throws {Error} When the entity is stale or does not carry the component.
 */
export function writeComponent(ctx: WorldCtx, entity: Entity, name: string, patch: object): void {
  const state = ctx.state.ecs;

  if (!isAlive(state, entity)) {
    throw new Error(
      `[game] Entity ${entity} is gone, so "${name}" cannot be written.\n` +
        "  A stale id reads undefined; check ecs.has(entity, Component) first."
    );
  }

  const stored = readComponent(state, entity, name);

  if (stored === undefined || stored === true) {
    throw new Error(
      `[game] Entity ${entity} carries no "${name}".\n` + "  Add the component before writing it."
    );
  }

  Object.assign(stored, patch);
  markChanged(state, name, entity);
}

/**
 * Returns the one mutable value of a resource, cloned from its defaults on first read.
 *
 * @param state - ecs module state.
 * @param resourceType - The resource type.
 * @returns The mutable resource value.
 */
export function resourceValue<Value extends object>(
  state: EcsState,
  resourceType: ResourceType<Value>
): Value {
  const known = state.resources.get(resourceType.resourceName);

  if (known !== undefined) return known as Value;

  const fresh = structuredClone(resourceType.defaults) as Value;

  state.resources.set(resourceType.resourceName, fresh);

  return fresh;
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
