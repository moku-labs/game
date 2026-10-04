/**
 * @file world plugin — API factory. The one place that builds `ecs` and injects it into
 * `projection`, and the one place that reduces both modules to their public half.
 */
import { createEcsApi } from "./ecs/api";
import { Exiting, Layer, Order, Tree } from "./ecs/define";
import type { EcsApi, FrameDiff, WorldMode } from "./ecs/types";
import { resolveDeps } from "./lifecycle";
import { createProjectionApi } from "./projection/api";
import type { ProjectionApi, WorldComponents } from "./projection/types";
import type { Api, EcsModule, KernelSlice, ProjectionModule, WorldCtx } from "./types";

/** The four components the projection writes; injected, never imported by the module. */
export const WORLD_COMPONENTS: WorldComponents = { Layer, Order, Exiting, Tree };

/**
 * Builds both modules in the accepted injection order `ecs → projection`. Each keeps its data in
 * its branch of `ctx.state`, so these objects are views on the plugin state, not owners of it.
 *
 * @param ctx - Domain context of the world plugin.
 * @returns Both modules with their public and internal methods.
 */
export function createModules(ctx: WorldCtx): {
  ecs: EcsModule;
  projection: ProjectionModule;
} {
  const ecs = createEcsApi(ctx);
  const projection = createProjectionApi(ctx, {
    ecs,
    components: WORLD_COMPONENTS
  });

  return { ecs, projection };
}

/**
 * Names the live projection key of every entity of a frame diff: `ecs` keeps the history, only
 * `projection` knows the addresses. An entity that is gone has no key, also when a stale one is
 * still registered for it.
 *
 * @param diff - The frame diff of the ecs module, every key `undefined`.
 * @param ecs - The full ecs module, for the liveness check.
 * @param projection - The full projection module, for the addresses.
 * @returns The same diff with the keys filled in.
 */
function withKeys(diff: FrameDiff, ecs: EcsModule, projection: ProjectionModule): FrameDiff {
  return {
    ...diff,
    entities: diff.entities.map(entity => ({
      ...entity,
      key: ecs.ownerOf(entity.id) === undefined ? undefined : projection.keyOf(entity.id)
    }))
  };
}

/**
 * Reduces the ecs module to what a game may call. Two members need both modules, which `ecs`
 * cannot do alone: `setMode("fast")` finishes every motion and flushes every despawn queue, and
 * `diff` names the projection key of every entity it reports.
 *
 * @param ecs - The full ecs module.
 * @param projection - The full projection module.
 * @returns The public ecs API.
 */
function exposeEcs(ecs: EcsModule, projection: ProjectionModule): EcsApi {
  return {
    system: ecs.system,
    spawn: ecs.spawn,
    despawn: ecs.despawn,
    despawnOwnedBy: ecs.despawnOwnedBy,
    get: ecs.get,
    set: ecs.set,
    add: ecs.add,
    remove: ecs.remove,
    has: ecs.has,
    tag: ecs.tag,
    untag: ecs.untag,
    query: ecs.query,
    resource: ecs.resource,
    onAdded: ecs.onAdded,
    onRemoved: ecs.onRemoved,
    changed: ecs.changed,
    typeOf: ecs.typeOf,
    ownerOf: ecs.ownerOf,
    mode: ecs.mode,
    setMode: (mode: WorldMode): void => {
      ecs.setMode(mode);
      if (ecs.mode() === "fast") projection.flushAll();
    },
    snapshot: ecs.snapshot,
    diff: (from: number, to: number): FrameDiff => withKeys(ecs.diff(from, to), ecs, projection),
    schema: ecs.schema
  };
}

/**
 * Reduces the projection module to what `scenes`, `input`, `i18n` and the `/inspect` door call.
 * The frame methods and the dirty flag stay with the plugin root.
 *
 * @param projection - The full projection module.
 * @returns The public projection API.
 */
function exposeProjection(projection: ProjectionModule): ProjectionApi {
  return {
    register: projection.register,
    setLayers: projection.setLayers,
    layers: projection.layers,
    mount: projection.mount,
    unmount: projection.unmount,
    settle: projection.settle,
    mute: projection.mute,
    lift: projection.lift,
    keyOf: projection.keyOf,
    motionsOf: projection.motionsOf,
    entityOf: projection.entityOf,
    entitiesOf: projection.entitiesOf,
    setDriver: projection.setDriver,
    viewOf: projection.viewOf,
    setRest: projection.setRest,
    restOf: projection.restOf,
    registerKey: projection.registerKey,
    rerunAll: projection.rerunAll
  };
}

/**
 * Creates the world API: `app.world.ecs` and `app.world.projection`.
 *
 * @param ctx - Kernel context of the world plugin.
 * @returns The plugin API.
 */
export function createWorldApi(ctx: KernelSlice): Api {
  const worldCtx: WorldCtx = { ...ctx, deps: resolveDeps(ctx) };
  const { ecs, projection } = createModules(worldCtx);

  return { ecs: exposeEcs(ecs, projection), projection: exposeProjection(projection) };
}
