/**
 * @file world/projection — API factory. The module keeps its data in `ctx.state.projection` and
 * reaches the entities only through the injected `ecs`.
 */
import type { Hint } from "../../flow/types";
import type { Root } from "../../model/types";
import type { ComponentType, Entity, Owner } from "../ecs/types";
import type { ProjectionModule, WorldCtx } from "../types";
import { cancelTracks, forgetEndedTracks, forgetJoined, runningComponents } from "./driver";
import {
  cancelHandles,
  createViewHandle,
  finishHandles,
  looseComponents,
  type Peers,
  playSettle,
  restingPeers,
  stillMoving,
  writeRestUnderLoops
} from "./motions";
import { checkLayers, mountNames, unmountNames } from "./mount";
import {
  clearMounted,
  dropIfStill,
  dropPending,
  flushQueues,
  forgetDeadElements,
  startOwedLoops,
  sweepQueue
} from "./queue";
import { reconcile } from "./reconcile";
import type {
  AnyProjectionSpec,
  Cause,
  Dirty,
  LayerSpec,
  MotionCause,
  Mounted,
  ProjectionCtx,
  ProjectionDeps,
  ProjectionKey,
  RestPose,
  TweenDriver,
  View,
  ViewHandle
} from "./types";
import { createViewRecord, writeLayer } from "./views";

/**
 * Tells whether a cause sets the picture instead of playing it.
 *
 * @param cause - Why the reconcile runs.
 * @returns True for a load, a restore, a mount and a forced re-run.
 * @example
 * ```ts
 * isDirectCause("edge"); // false
 * isDirectCause("load"); // true
 * ```
 */
function isDirectCause(cause: Cause): boolean {
  return cause === "load" || cause === "restore" || cause === "mount" || cause === "rerun";
}

/**
 * Tells whether a cause replaces the state, so every live view has to stand on its rest pose
 * when the reconcile ends, also a view whose item is the same object as before, and every
 * element on the rest pose its owner recorded.
 *
 * @param cause - Why the reconcile runs.
 * @returns True for a load and a restore.
 * @example
 * ```ts
 * isConvergeCause("restore"); // true
 * isConvergeCause("rerun"); // false
 * ```
 */
function isConvergeCause(cause: Cause): boolean {
  return cause === "load" || cause === "restore";
}

/**
 * Creates the empty mute table of one entity. It lives in its own non-exported function because
 * lint rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty table of component name to owned fields.
 */
function emptyMuteTable(): Map<string, Set<string>> {
  return new Map();
}

/**
 * Creates the empty field set of one muted component.
 *
 * @returns An empty set of field names.
 */
function emptyFieldSet(): Set<string> {
  return new Set();
}

/**
 * Deletes a released field set once it is empty, and the entity's table once no component is
 * left. Only the set and table still stored are touched, so a remover that runs after a clear
 * never drops a newer mute.
 *
 * @param mutes - The mute tables of every entity.
 * @param entity - The muted entity.
 * @param name - The muted component's name.
 * @param owned - The field set the remover released from.
 */
function dropEmptyMute(
  mutes: Map<Entity, Map<string, Set<string>>>,
  entity: Entity,
  name: string,
  owned: Set<string>
): void {
  const byComponent = mutes.get(entity);

  if (owned.size > 0 || byComponent?.get(name) !== owned) return;

  byComponent.delete(name);
  if (byComponent.size === 0) mutes.delete(entity);
}

/**
 * Creates the empty dirty record the next reconcile reads.
 *
 * @returns Nothing to reconcile yet.
 */
function emptyDirty(): Dirty {
  return { causes: [], roots: new Set(), force: false };
}

/**
 * Creates the empty rest pose of one entity a plugin above owns.
 *
 * @returns An empty table of component name to value.
 */
function emptyRest(): RestPose {
  return new Map();
}

/**
 * Creates the empty key table of one projection.
 *
 * @returns An empty table of key to entity.
 */
function emptyKeys(): Map<string, Entity> {
  return new Map();
}

/**
 * The entities of the live views of a mounted projection, in the order of the model keys of its
 * last reconcile. A view that plays its exit has already left `live`.
 *
 * @param mounted - The mounted projection.
 * @returns A new array of entities.
 */
function liveEntities(mounted: Mounted): Entity[] {
  const entities: Entity[] = [];

  for (const key of mounted.items.keys()) {
    const view = mounted.live.get(key);

    if (view !== undefined && !view.exiting) entities.push(view.entity);
  }

  return entities;
}

/**
 * Creates the peers of a handle that belongs to no projection: nothing to answer from.
 *
 * @returns Two empty item tables.
 */
function noPeers(): Peers {
  return { next: new Map(), previous: new Map() };
}

/**
 * Creates the projection module: the public API `scenes`, `input` and `i18n` call, plus the
 * methods the plugin root drives from the frame and the `model:committed` hook.
 *
 * @param ctx - Domain context of the world plugin.
 * @param deps - The injected `ecs` module and the world-owned components.
 * @returns The projection API and its internal half.
 */
export function createProjectionApi(ctx: WorldCtx, deps: ProjectionDeps): ProjectionModule {
  const pctx: ProjectionCtx = { ctx, deps };
  const state = ctx.state.projection;

  /**
   * Reconciles what is dirty. The cause table decides play or direct, whether every live view
   * and every element with a recorded rest pose is brought to it (a restore and a load do that),
   * and whether an unchanged view that stands off its rest pose is settled (a rollback does).
   */
  const reconcileIfDirty = (): void => {
    const dirty = state.dirty;

    state.dirty = undefined;

    if (dirty !== undefined && (dirty.roots.has("player") || dirty.roots.has("session"))) {
      const direct =
        dirty.force ||
        dirty.causes.some(cause => isDirectCause(cause)) ||
        deps.ecs.mode() !== "live";
      const converge = dirty.causes.some(cause => isConvergeCause(cause));
      const settle = dirty.causes.includes("rollback");

      reconcile(pctx, { direct, force: dirty.force, converge, settle });
    }

    state.hints.length = 0;
  };

  /**
   * Marks every mounted projection dirty and forces `view` for every item on the next frame.
   */
  const forceRerun = (): void => {
    const dirty = state.dirty ?? emptyDirty();

    dirty.causes.push("rerun");
    dirty.roots.add("player");
    dirty.roots.add("session");
    dirty.force = true;
    state.dirty = dirty;
  };

  const restOf = (entity: Entity): RestPose => state.rests.get(entity) ?? emptyRest();

  // The view record a handle of a plugin-owned element runs on. It never reaches `byEntity`, so
  // no reconcile ever meets it: the owner drives it and records its rest pose with `setRest`.
  const elementView = (entity: Entity): View =>
    createViewRecord(
      entity,
      state.keysByEntity.get(entity)?.projection ?? "",
      state.keysByEntity.get(entity)?.key ?? "",
      undefined,
      restOf(entity)
    );

  const api: ProjectionModule = {
    register: (spec: AnyProjectionSpec): void => {
      if (state.specs.has(spec.name)) {
        throw new Error(
          `[game] Projection "${spec.name}" is registered twice.\n` +
            "  Give the second projection another name."
        );
      }

      state.specs.set(spec.name, spec);
    },

    replace: (spec: AnyProjectionSpec): void => {
      if (!state.specs.has(spec.name)) {
        throw new Error(
          `[game] Projection "${spec.name}" is not registered.\n` +
            "  Register it before replacing it."
        );
      }

      const mounted = state.mounted.has(spec.name);

      if (mounted) checkLayers(pctx, spec);
      state.specs.set(spec.name, spec);
      if (mounted) forceRerun();
    },

    setLayers: (list: ReadonlyArray<LayerSpec>): void => {
      state.layers = Object.freeze(list.map(layer => ({ ...layer })));
    },

    layers: (): ReadonlyArray<LayerSpec> => state.layers,

    mount: (names: readonly string[], owner: Owner): void => {
      mountNames(pctx, names, owner);
    },

    unmount: (names: readonly string[]): void => {
      unmountNames(pctx, names);
    },

    restOf: <Value extends object>(
      entity: Entity,
      component: ComponentType<Value>
    ): Value | undefined => {
      const rest = state.byEntity.get(entity)?.rest ?? state.rests.get(entity);
      const stored = rest?.get(component.componentName);

      return stored === undefined ? undefined : (stored.value as Value);
    },

    settle: (entity: Entity): void => {
      const view = state.byEntity.get(entity);

      if (view === undefined || view.exiting) return;

      const spec = state.specs.get(view.projection);
      const mounted = state.mounted.get(view.projection);

      if (spec === undefined || mounted === undefined) return;

      cancelHandles(view);
      forgetEndedTracks(pctx);

      if (deps.ecs.mode() !== "live") {
        // No flush follows: a loop of the view stands and runs on when the world is live again.
        writeRestUnderLoops(pctx, view, [...view.rest.keys()]);
        // Only a pending `lift(false)` drops the view. A view the finger still holds stays lifted.
        dropPending(pctx, view);

        return;
      }

      playSettle(pctx, view, spec, restingPeers(mounted), looseComponents(pctx, view));
      // The motions were cancelled: when no new one started, a pending `lift(false)` takes effect.
      dropIfStill(pctx, view);
    },

    mute: (
      entity: Entity,
      component: ComponentType<object>,
      fields: readonly string[]
    ): (() => void) => {
      const byComponent = state.mutes.get(entity) ?? emptyMuteTable();
      const owned = byComponent.get(component.componentName) ?? emptyFieldSet();

      for (const field of fields) owned.add(field);
      forgetJoined(state, owned);
      byComponent.set(component.componentName, owned);
      state.mutes.set(entity, byComponent);

      let released = false;

      return (): void => {
        if (released) return;

        released = true;
        for (const field of fields) owned.delete(field);
        forgetJoined(state, owned);
        dropEmptyMute(state.mutes, entity, component.componentName, owned);
      };
    },

    lift: (entity: Entity, on: boolean): void => {
      const view = state.byEntity.get(entity);

      if (view === undefined) return;

      const spec = state.specs.get(view.projection);

      if (spec?.lift === undefined) return;

      if (on) {
        view.lifted = true;
        view.dropWhenStill = false;
        writeLayer(pctx, entity, spec.lift);

        return;
      }

      if (stillMoving(view)) {
        view.dropWhenStill = true;

        return;
      }

      view.lifted = false;
      view.dropWhenStill = false;
      writeLayer(pctx, entity, spec.layer);
    },

    keyOf: (entity: Entity): ProjectionKey | undefined =>
      state.byEntity.get(entity)?.address ?? state.keysByEntity.get(entity),

    membershipVersion: (): number => state.membershipVersion,

    causeOf: (entity: Entity): MotionCause | undefined =>
      state.byEntity.get(entity)?.cause ?? state.leaving.get(entity),

    motionsOf: (entity: Entity): readonly string[] => runningComponents(state.tracks, entity),

    entityOf: (projection: string, key: string): Entity | undefined =>
      state.mounted.get(projection)?.live.get(key)?.entity ?? state.keys.get(projection)?.get(key),

    entitiesOf: (name: string): readonly Entity[] => {
      const mounted = state.mounted.get(name);

      return mounted === undefined ? [] : liveEntities(mounted);
    },

    setDriver: (driver: TweenDriver): (() => void) => {
      state.driver = driver;

      return (): void => {
        if (state.driver === driver) state.driver = undefined;
      };
    },

    viewOf: (entity: Entity, owner: Owner): ViewHandle<unknown> | undefined => {
      const known = deps.ecs.ownerOf(entity);

      if (known === undefined || known.kind !== "plugin") return undefined;
      if (owner.kind !== known.kind || owner.name !== known.name) return undefined;

      // The handle and a later `setRest` share one pose object. The key remover drops it, and so
      // does the sweep once the entity is gone.
      state.rests.set(entity, restOf(entity));

      return createViewHandle(pctx, elementView(entity), noPeers());
    },

    setRest: <Value extends object>(
      entity: Entity,
      component: ComponentType<Value>,
      value: Value
    ): void => {
      if (deps.ecs.ownerOf(entity) === undefined) return;

      const pose = restOf(entity);

      pose.set(component.componentName, component(value));
      state.rests.set(entity, pose);
    },

    registerKey: (projection: string, key: string, entity: Entity): (() => void) => {
      if (state.mounted.get(projection)?.live.has(key) === true) {
        throw new Error(
          `[game] Key "${key}" of projection "${projection}" is already a live view.\n` +
            "  Register the element under another key."
        );
      }

      const byKey = state.keys.get(projection) ?? emptyKeys();

      byKey.set(key, entity);
      state.keys.set(projection, byKey);
      state.keysByEntity.set(entity, { projection, key });
      // The next sweep looks for dead elements, also when no entity was despawned since the last.
      state.sweptDespawns = -1;

      return (): void => {
        if (byKey.get(key) === entity) byKey.delete(key);
        if (state.keysByEntity.get(entity)?.key === key) state.keysByEntity.delete(entity);
        state.rests.delete(entity);
      };
    },

    onConverged: (listener: () => void): (() => void) => {
      state.converged.push(listener);

      return (): void => {
        const at = state.converged.indexOf(listener);

        if (at !== -1) state.converged.splice(at, 1);
      };
    },

    rerunAll: forceRerun,

    markDirty: (roots: readonly Root[], cause: Cause): void => {
      const dirty = state.dirty ?? emptyDirty();

      dirty.causes.push(cause);
      for (const root of roots) dirty.roots.add(root);
      state.dirty = dirty;

      if (deps.ecs.mode() === "fast") reconcileIfDirty();
    },

    reconcileIfDirty,

    dropHints: (): void => {
      state.hints.length = 0;
    },

    pushHint: (hint: Hint): void => {
      state.hints.push(hint);
    },

    sweep: (): void => {
      if (deps.ecs.mode() !== "live") return;

      sweepQueue(pctx);

      // Per frame: an element's key and rest pose can only go stale when an entity was despawned.
      const despawns = ctx.state.ecs.despawns;

      if (state.sweptDespawns !== despawns) {
        state.sweptDespawns = despawns;
        forgetDeadElements(pctx);
      }

      if (state.owedLoops > 0) startOwedLoops(pctx);
    },

    flushAll: (): void => {
      for (const view of state.byEntity.values()) {
        finishHandles(view);
        cancelTracks(pctx, view.entity);
      }

      flushQueues(pctx);
      forgetEndedTracks(pctx);
    },

    ownerLeft: (owner: Owner): void => {
      if (owner.kind !== "projection") return;

      const mounted = state.mounted.get(owner.name);

      if (mounted !== undefined) clearMounted(pctx, mounted);
    },

    clear: (): void => {
      // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
      for (const mounted of [...state.mounted.values()]) clearMounted(pctx, mounted);
      state.mounted.clear();
      state.specs.clear();
      state.byEntity.clear();
      state.mutes.clear();
      state.rests.clear();
      state.keys.clear();
      state.keysByEntity.clear();
      state.leaving.clear();
      state.tracks.length = 0;
      state.hints.length = 0;
      state.dirty = undefined;
      state.layers = Object.freeze([]);
      state.membershipVersion += 1;
    }
  };

  return api;
}
