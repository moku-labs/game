/**
 * @file renderer plugin — API factory. The one place that builds `host`, `viewport`, `demand`,
 * `kept`, `sync` and `monitor` in the accepted injection order, and the one place that reduces
 * them to their public half.
 */
import { createDemandApi } from "./demand/api";
import { createHostApi } from "./host/api";
import type { HostApi, InstallCounting } from "./host/types";
import { createKeptApi } from "./kept/api";
import { resolveDeps } from "./lifecycle";
import { createMonitorApi } from "./monitor/api";
import { installCounting, installPassCounting } from "./monitor/draw-calls";
import { createSyncApi } from "./sync/api";
import { applyFilters, clearFilters, renderPassesOf } from "./sync/filters";
import { hiddenBy, hiddenOnlyAmong, liftFor, swapHidden } from "./sync/hidden";
import type { SyncApi, SyncWriters } from "./sync/types";
import type { Api, HostModule, KernelSlice, Modules, RendererCtx, SyncModule } from "./types";
import { createViewportApi } from "./viewport/api";
import type { ViewportApi } from "./viewport/types";

/**
 * The counting `host` installs before `new Application()`: the seven counting classes (BatcherPipe among them) of
 * `monitor` in a dev build and in a debug build, bound to the sinks in the monitor branch of the
 * state, none in production. A production `define` folds the dev or agent guard, so the counting
 * module leaves the bundle.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @returns The bound installer, or `undefined` without the dev flag and the agent flag.
 */
function countingOf(ctx: RendererCtx): InstallCounting | undefined {
  return (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
    (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
    ? pixi => installCounting(pixi, ctx.state.monitor.sinks)
    : undefined;
}

/**
 * The writers of `sync` the kept cache draws through: the one owner of `renderable`, the one writer of a view's
 * filters, and the pass estimate a range picture reads while it is lifted. Injected here, since a module never
 * imports another's run-time code.
 */
const syncWriters: SyncWriters = {
  swapHidden,
  hiddenBy,
  hiddenOnlyAmong,
  liftFor,
  applyFilters,
  clearFilters,
  renderPassesOf
};

/**
 * Builds the six modules in the accepted order `host → viewport → demand → kept → sync → monitor`.
 * Each keeps its data in its branch of `ctx.state`, so these objects are views on the plugin
 * state, not owners of it. `host` gets the counting of `monitor` up front, because it installs
 * the classes before `monitor` exists (the six of a dev or debug build, the pass counter of the
 * others); `demand` reads the views of `sync` and the kept pictures through the state, whose maps
 * keep their identity; `kept` reads the views of `sync` the same way, and gives a bare view its
 * wrapper through `sync.wrapForPicture` (spec 23 D4), reached through a holder filled once `sync`
 * exists; `sync` marks every write in
 * `demand` and asks `kept` where a view's filters hang; `monitor` gets the others, since a legend
 * places views on the picture and the performance log reads all of them.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @returns The six modules with their public and internal methods.
 */
export function createModules(ctx: RendererCtx): Modules {
  const host = createHostApi(ctx, {
    installCounting: countingOf(ctx),
    installPasses: pixi => installPassCounting(pixi, ctx.state.monitor.sinks)
  });
  const viewport = createViewportApi(ctx, { host });
  const demand = createDemandApi(ctx, { host, views: ctx.state.sync.views, hiddenBy });
  // `kept` is built before `sync`: its wrap reaches `sync` through this holder, filled below, first called in a flush.
  const built: { sync?: SyncModule } = {};
  const kept = createKeptApi(ctx, {
    host,
    demand,
    sync: syncWriters,
    wrap: entity => built.sync?.wrapForPicture(entity)
  });
  const sync = createSyncApi(ctx, { host, viewport, demand, kept });

  built.sync = sync;
  const monitor = createMonitorApi(ctx, { host, viewport, sync, demand, kept });

  return { host, viewport, demand, kept, sync, monitor };
}

/**
 * Reduces the host module to the questions a caller may ask.
 *
 * @param host - The full host module.
 * @returns The public host API.
 */
function exposeHost(host: HostModule): HostApi {
  return {
    ready: host.ready,
    kind: host.kind,
    canvas: host.canvas,
    pixi: host.pixi,
    device: host.device,
    gl: host.gl,
    resolution: host.resolution
  };
}

/**
 * Reduces the sync module to what `input`, `assets`, `effects`, the doors and a debugging game
 * call. There is no `layers` member: layers are declared by the scene, through
 * `world.projection.setLayers`.
 *
 * @param sync - The full sync module.
 * @returns The public sync API.
 */
function exposeSync(sync: SyncModule): SyncApi {
  return {
    hitTest: sync.hitTest,
    hitAll: sync.hitAll,
    boundsOf: sync.boundsOf,
    hitBoxOf: sync.hitBoxOf,
    textures: sync.textures,
    displays: sync.displays,
    fonts: sync.fonts,
    debug: sync.debug,
    filters: sync.filters,
    renderPasses: sync.renderPasses,
    loopsHeld: sync.loopsHeld,
    displayOf: sync.displayOf
  };
}

/**
 * Creates the renderer API: `app.renderer.host`, `.viewport`, `.sync` and `.monitor`, and
 * `stats()` and `capture()` of `monitor` on the plugin itself.
 *
 * @param ctx - Kernel context of the renderer plugin.
 * @returns The plugin API.
 */
export function createRendererApi(ctx: KernelSlice): Api {
  const rendererCtx: RendererCtx = { ...ctx, deps: resolveDeps(ctx) };
  const { host, viewport, demand, sync, monitor } = createModules(rendererCtx);
  const publicViewport: ViewportApi = {
    toReference: viewport.toReference,
    toScreen: viewport.toScreen,
    size: viewport.size
  };

  return {
    host: exposeHost(host),
    viewport: publicViewport,
    sync: exposeSync(sync),
    monitor: {
      stream: monitor.stream,
      frames: monitor.frames,
      mark: monitor.mark,
      event: monitor.event,
      beginAgent: monitor.beginAgent,
      endAgent: monitor.endAgent,
      setResolution: monitor.setResolution,
      sections: monitor.sections,
      counts: monitor.counts
    },
    invalidate: demand.invalidate,
    stats: monitor.stats,
    capture: monitor.capture
  };
}
