/**
 * @file renderer plugin — API factory. The one place that builds `host`, `viewport` and `sync`
 * in the accepted injection order, and the one place that reduces them to their public half.
 */
import { createHostApi } from "./host/api";
import type { HostApi } from "./host/types";
import { resolveDeps } from "./lifecycle";
import { createSyncApi } from "./sync/api";
import type { SyncApi } from "./sync/types";
import type { Api, HostModule, KernelSlice, Modules, RendererCtx, SyncModule } from "./types";
import { createViewportApi } from "./viewport/api";
import type { ViewportApi } from "./viewport/types";

/**
 * Builds the three modules in the accepted order `host → viewport → sync`. Each keeps its data
 * in its branch of `ctx.state`, so these objects are views on the plugin state, not owners of it.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @returns The three modules with their public and internal methods.
 */
export function createModules(ctx: RendererCtx): Modules {
  const host = createHostApi(ctx);
  const viewport = createViewportApi(ctx, { host });
  const sync = createSyncApi(ctx, { host, viewport });

  return { host, viewport, sync };
}

/**
 * Reduces the host module to the three questions a caller may ask.
 *
 * @param host - The full host module.
 * @returns The public host API.
 */
function exposeHost(host: HostModule): HostApi {
  return { ready: host.ready, kind: host.kind, canvas: host.canvas, pixi: host.pixi };
}

/**
 * Reduces the sync module to what `input`, `assets` and a debugging game call. There is no
 * `layers` member: layers are declared by the scene, through `world.projection.setLayers`.
 *
 * @param sync - The full sync module.
 * @returns The public sync API.
 */
function exposeSync(sync: SyncModule): SyncApi {
  return {
    hitTest: sync.hitTest,
    textures: sync.textures,
    displays: sync.displays,
    fonts: sync.fonts,
    debug: sync.debug,
    displayOf: sync.displayOf
  };
}

/**
 * Creates the renderer API: `app.renderer.host`, `.viewport` and `.sync`.
 *
 * @param ctx - Kernel context of the renderer plugin.
 * @returns The plugin API.
 */
export function createRendererApi(ctx: KernelSlice): Api {
  const rendererCtx: RendererCtx = { ...ctx, deps: resolveDeps(ctx) };
  const { host, viewport, sync } = createModules(rendererCtx);
  const publicViewport: ViewportApi = { toReference: viewport.toReference, size: viewport.size };

  return { host: exposeHost(host), viewport: publicViewport, sync: exposeSync(sync) };
}
