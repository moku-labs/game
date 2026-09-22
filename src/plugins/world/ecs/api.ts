/**
 * @file world/ecs — API factory. The module keeps its data in `ctx.state.ecs`, so the object this
 * returns is a view on the plugin state, not the owner of it.
 */
import type { Time } from "../../time/types";
import type { EcsModule, WorldCtx } from "../types";
import { changesOf, clearAllChanges } from "./changes";
import { despawnEntity, flushCommands, queueOrApply } from "./commands";
import { reserveEntity } from "./entities";
import { runQuery } from "./query";
import { snapshotWorld } from "./snapshot";
import {
  addHook,
  asComponent,
  readComponent,
  registerType,
  resourceValue,
  writeComponent
} from "./storage";
import { effectiveMode, registerSystem, runPhase } from "./systems";
import type {
  AnyComponentType,
  AnyComponentValue,
  AnySystem,
  ComponentHandle,
  Entity,
  Owner,
  QueryTerm,
  QueryTuple,
  ResourceType,
  StructuralHook,
  TagType,
  WorldMode,
  WorldPhase
} from "./types";

/**
 * Empties the world in place: entities, components, resources, systems and hooks. The state
 * object keeps its identity, so every view on it stays valid.
 *
 * @param ctx - Domain context of the world plugin.
 */
function clearWorldState(ctx: WorldCtx): void {
  const state = ctx.state.ecs;

  for (const entity of state.owners.keys()) despawnEntity(ctx, entity);

  state.generations.length = 0;
  state.free.length = 0;
  state.owners.clear();
  state.byOwner.clear();
  state.types.clear();
  state.stores.clear();
  state.resources.clear();
  state.systems.input.length = 0;
  state.systems.animate.length = 0;
  state.systems.layout.length = 0;
  state.systems.sync.length = 0;
  state.running = undefined;
  state.commands.length = 0;
  state.changed.clear();
  state.added.clear();
  state.removed.clear();
  state.ownerLeft.length = 0;
  state.mode = "live";
  state.frameSnapshot = undefined;
}

/**
 * Creates the ecs module: the public API a game and the plugins above call, plus the four methods
 * the plugin root and `projection` are given.
 *
 * @param ctx - Domain context of the world plugin.
 * @returns The ecs API and its internal half.
 */
export function createEcsApi(ctx: WorldCtx): EcsModule {
  const state = ctx.state.ecs;

  const api: EcsModule = {
    system: (definition: AnySystem): (() => void) => registerSystem(ctx, definition),

    spawn: (owner: Owner, components: readonly AnyComponentValue[]): Entity => {
      const entity = reserveEntity(state, owner);

      queueOrApply(ctx, { kind: "attach", entity, components });

      return entity;
    },

    despawn: (entity: Entity): void => {
      queueOrApply(ctx, { kind: "despawn", entity });
    },

    despawnOwnedBy: (owner: Owner): void => {
      queueOrApply(ctx, { kind: "despawnOwnedBy", owner });
    },

    get: <Value extends object>(
      entity: Entity,
      component: ComponentHandle<Value>
    ): Readonly<Value> | undefined => {
      registerType(ctx, component);

      const stored = readComponent(state, entity, component.componentName);

      // The store holds the value this component type describes; a tag stores `true`.
      return stored === undefined || stored === true ? undefined : (stored as Readonly<Value>);
    },

    set: <Value extends object>(
      entity: Entity,
      component: ComponentHandle<Value>,
      patch: Partial<Value>
    ): void => {
      registerType(ctx, component);
      writeComponent(ctx, entity, component.componentName, patch);
    },

    add: (entity: Entity, value: AnyComponentValue): void => {
      queueOrApply(ctx, { kind: "add", entity, value });
    },

    remove: (entity: Entity, component: AnyComponentType): void => {
      registerType(ctx, component);
      queueOrApply(ctx, { kind: "remove", entity, component: component.componentName });
    },

    has: (entity: Entity, component: AnyComponentType): boolean => {
      registerType(ctx, component);

      return readComponent(state, entity, component.componentName) !== undefined;
    },

    tag: (entity: Entity, tagType: TagType): void => {
      queueOrApply(ctx, { kind: "add", entity, value: tagType() });
    },

    untag: (entity: Entity, tagType: TagType): void => {
      registerType(ctx, tagType);
      queueOrApply(ctx, { kind: "remove", entity, component: tagType.componentName });
    },

    query: <const Terms extends readonly QueryTerm[]>(
      ...terms: Terms
    ): Iterable<QueryTuple<Terms>> =>
      // The generator builds exactly this tuple: the entity, then one stored value per term.
      runQuery(ctx, terms) as Iterable<QueryTuple<Terms>>,

    resource: <Value extends object>(resourceType: ResourceType<Value>): Value =>
      resourceValue(state, resourceType),

    onAdded: <Value extends object>(
      component: ComponentHandle<Value>,
      fn: (entity: Entity, value: Readonly<Value>) => void
    ): (() => void) => {
      registerType(ctx, component);

      const hook: StructuralHook = (entity, value) => fn(entity, value as Readonly<Value>);

      return addHook(state.added, component.componentName, hook);
    },

    onRemoved: <Value extends object>(
      component: ComponentHandle<Value>,
      fn: (entity: Entity, value: Readonly<Value>) => void
    ): (() => void) => {
      registerType(ctx, component);

      const hook: StructuralHook = (entity, value) => fn(entity, value as Readonly<Value>);

      return addHook(state.removed, component.componentName, hook);
    },

    changed: (component: AnyComponentType): Iterable<Entity> => {
      registerType(ctx, component);

      return changesOf(state, component.componentName);
    },

    mode: (): WorldMode => effectiveMode(ctx),

    setMode: (mode: WorldMode): void => {
      state.mode = mode;
    },

    typeOf: (name: string) => asComponent(state.types.get(name)),

    snapshot: () => snapshotWorld(state, effectiveMode(ctx)),

    ownerOf: (entity: Entity): Owner | undefined => state.owners.get(entity),

    onOwnerLeft: (fn: (owner: Owner) => void): (() => void) => {
      state.ownerLeft.push(fn);

      return (): void => {
        const at = state.ownerLeft.indexOf(fn);

        if (at !== -1) state.ownerLeft.splice(at, 1);
      };
    },

    runPhase: (phase: WorldPhase, time: Readonly<Time>): void => {
      runPhase(ctx, api, phase, time);
    },

    flush: (): void => {
      flushCommands(ctx);
    },

    clearChanges: (): void => {
      clearAllChanges(state);
    },

    clear: (): void => {
      clearWorldState(ctx);
    }
  };

  return api;
}
