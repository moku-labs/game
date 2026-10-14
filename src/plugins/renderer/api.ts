/**
 * @file renderer plugin — API factory. The one place that builds `host`, `viewport`, `sync` and
 * `monitor` in the accepted injection order, and the one place that reduces them to their public
 * half.
 */
import { createHostApi } from "./host/api";
import type { HostApi, InstallCounting } from "./host/types";
import { resolveDeps } from "./lifecycle";
import { createMonitorApi } from "./monitor/api";
import { installCounting } from "./monitor/draw-calls";
import { createSyncApi } from "./sync/api";
import type { SyncApi } from "./sync/types";
import type { Api, HostModule, KernelSlice, Modules, RendererCtx, SyncModule } from "./types";
import { createViewportApi } from "./viewport/api";
import type { ViewportApi } from "./viewport/types";

/**
 * The counting `host` installs before `new Application()`: the six counting classes of
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
 * Builds the four modules in the accepted order `host → viewport → sync → monitor`. Each keeps
 * its data in its branch of `ctx.state`, so these objects are views on the plugin state, not
 * owners of it. `host` gets the counting of `monitor` up front, because it installs the classes
 * before `monitor` exists; `monitor` gets the other three, since a legend places views on the
 * picture and the performance log reads all of them.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @returns The four modules with their public and internal methods.
 */
export function createModules(ctx: RendererCtx): Modules {
  const host = createHostApi(ctx, { installCounting: countingOf(ctx) });
  const viewport = createViewportApi(ctx, { host });
  const sync = createSyncApi(ctx, { host, viewport });
  const monitor = createMonitorApi(ctx, { host, viewport, sync });

  return { host, viewport, sync, monitor };
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
  const { host, viewport, sync, monitor } = createModules(rendererCtx);
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
      setResolution: monitor.setResolution
    },
    stats: monitor.stats,
    capture: monitor.capture
  };
}
