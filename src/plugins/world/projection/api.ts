/**
 * @file world/projection — API factory. The module keeps its data in `ctx.state.projection` and
 * reaches the entities only through the injected `ecs`.
 */
import type { Hint } from "../../flow/types";
import type { Root } from "../../model/types";
import type { ComponentType, Entity, Owner } from "../ecs/types";
import type { ProjectionModule, WorldCtx } from "../types";
import {
  cancelHandles,
  finishHandles,
  looseComponents,
  playSettle,
  stillMoving,
  writeRestNow
} from "./motions";
import { clearMounted, flushQueues, sweepQueue } from "./queue";
import { reconcile, restingPeers } from "./reconcile";
import { advanceTracks } from "./tween";
import type {
  AnyProjectionSpec,
  Cause,
  Dirty,
  LayerSpec,
  Mounted,
  ProjectionCtx,
  ProjectionDeps
} from "./types";
import { writeLayer } from "./views";

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
 * Creates the empty view tables of a freshly mounted projection. These live in their own
 * non-exported functions because lint rule L5 refuses a collection built inside an exported
 * declaration.
 *
 * @param owner - Who owns the entities of this projection.
 * @returns A mounted projection with nothing in it yet.
 */
function emptyMounted(owner: Owner): Mounted {
  return { owner, live: new Map(), queue: [], items: new Map() };
}

/**
 * Creates the empty mute table of one entity.
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
 * Creates the empty dirty record the next reconcile reads.
 *
 * @returns Nothing to reconcile yet.
 */
function emptyDirty(): Dirty {
  return { causes: [], roots: new Set(), force: false };
}

/**
 * Checks that every layer a projection names is declared by the scene.
 *
 * @param pctx - Domain context of the projection module.
 * @param spec - The projection spec.
 * @throws {Error} When `layer` or `lift` is not in the layer list.
 */
function checkLayers(pctx: ProjectionCtx, spec: AnyProjectionSpec): void {
  const declared = new Set(pctx.ctx.state.projection.layers.map(layer => layer.name));

  for (const name of [spec.layer, spec.lift]) {
    if (name === undefined || declared.has(name)) continue;

    throw new Error(
      `[game] Projection "${spec.name}" names layer "${name}", which the scene does not declare.\n` +
        "  Add it to the layers of the scene."
    );
  }
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
   * Reconciles what is dirty. The cause table decides play or direct.
   */
  const reconcileIfDirty = (): void => {
    const dirty = state.dirty;

    state.dirty = undefined;

    if (dirty !== undefined && (dirty.roots.has("player") || dirty.roots.has("session"))) {
      const direct =
        dirty.force ||
        dirty.causes.some(cause => isDirectCause(cause)) ||
        deps.ecs.mode() !== "live";

      reconcile(pctx, { direct, force: dirty.force });
    }

    state.hints.length = 0;
  };

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

    setLayers: (list: ReadonlyArray<LayerSpec>): void => {
      state.layers = Object.freeze(list.map(layer => ({ ...layer })));
    },

    layers: (): ReadonlyArray<LayerSpec> => state.layers,

    mount: (names: readonly string[], owner: Owner): void => {
      const fresh: AnyProjectionSpec[] = [];

      for (const name of names) {
        const spec = state.specs.get(name);

        if (spec === undefined) {
          throw new Error(
            `[game] Projection "${name}" is not registered.\n` +
              "  Register it before a scene mounts it."
          );
        }

        if (state.mounted.has(name)) {
          ctx.log.warn("world:already-mounted", { projection: name });

          continue;
        }

        checkLayers(pctx, spec);
        fresh.push(spec);
      }

      for (const spec of fresh) state.mounted.set(spec.name, emptyMounted(owner));

      if (fresh.length > 0) {
        reconcile(pctx, { names: fresh.map(spec => spec.name), direct: true, force: true });
      }
    },

    unmount: (names: readonly string[]): void => {
      for (const name of names) {
        const mounted = state.mounted.get(name);

        if (mounted === undefined) continue;

        clearMounted(pctx, mounted);
        state.mounted.delete(name);
      }
    },

    settle: (entity: Entity): void => {
      const view = state.byEntity.get(entity);

      if (view === undefined || view.exiting) return;

      const spec = state.specs.get(view.projection);
      const mounted = state.mounted.get(view.projection);

      if (spec === undefined || mounted === undefined) return;

      cancelHandles(view);

      if (deps.ecs.mode() !== "live") {
        writeRestNow(pctx, view, [...view.rest.keys()]);
        view.dropWhenStill = false;
        view.lifted = false;
        writeLayer(pctx, entity, spec.layer);

        return;
      }

      playSettle(pctx, view, spec, restingPeers(mounted), looseComponents(pctx, view));
    },

    mute: (
      entity: Entity,
      component: ComponentType<object>,
      fields: readonly string[]
    ): (() => void) => {
      const byComponent = state.mutes.get(entity) ?? emptyMuteTable();
      const owned = byComponent.get(component.componentName) ?? emptyFieldSet();

      for (const field of fields) owned.add(field);
      byComponent.set(component.componentName, owned);
      state.mutes.set(entity, byComponent);

      let released = false;

      return (): void => {
        if (released) return;

        released = true;
        for (const field of fields) owned.delete(field);
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

    keyOf: (entity: Entity) => {
      const view = state.byEntity.get(entity);

      return view === undefined ? undefined : { projection: view.projection, key: view.key };
    },

    entityOf: (projection: string, key: string): Entity | undefined =>
      state.mounted.get(projection)?.live.get(key)?.entity,

    rerunAll: (): void => {
      const dirty = state.dirty ?? emptyDirty();

      dirty.causes.push("rerun");
      dirty.roots.add("player");
      dirty.roots.add("session");
      dirty.force = true;
      state.dirty = dirty;
    },

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

    advance: (deltaMs: number): void => {
      if (deps.ecs.mode() !== "live") return;

      advanceTracks(pctx, deltaMs);
      sweepQueue(pctx);
    },

    flushAll: (): void => {
      for (const view of state.byEntity.values()) finishHandles(view);
      flushQueues(pctx);
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
      state.tracks.length = 0;
      state.hints.length = 0;
      state.dirty = undefined;
      state.layers = Object.freeze([]);
    }
  };

  return api;
}
