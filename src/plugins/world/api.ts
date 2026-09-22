/**
 * @file world plugin — API factory. The one place that builds `ecs` and injects it into
 * `projection`, and the one place that reduces both modules to their public half.
 */
import { createEcsApi } from "./ecs/api";
import { Exiting, Layer, Order, Tree } from "./ecs/define";
import type { EcsApi, WorldMode } from "./ecs/types";
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
    ecsInternal: ecs,
    components: WORLD_COMPONENTS
  });

  return { ecs, projection };
}

/**
 * Reduces the ecs module to what a game may call, and makes `setMode("fast")` finish every motion
 * and flush every despawn queue, which is the one thing `ecs` cannot do alone.
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
    mode: ecs.mode,
    setMode: (mode: WorldMode): void => {
      ecs.setMode(mode);
      if (ecs.mode() === "fast") projection.flushAll();
    },
    snapshot: ecs.snapshot
  };
}

/**
 * Reduces the projection module to what `scenes`, `input` and `i18n` call. The frame methods and
 * the dirty flag stay with the plugin root.
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
    entityOf: projection.entityOf,
    setDriver: projection.setDriver,
    viewOf: projection.viewOf,
    setRest: projection.setRest,
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
