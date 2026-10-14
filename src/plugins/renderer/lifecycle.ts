/**
 * @file renderer plugin — lifecycle functions: dependency resolution, the `onStart` sequence
 * host → viewport → sync, and the teardown that undoes exactly what it created.
 */
import { clockPlugin } from "../clock";
import { flowPlugin } from "../flow";
import { lifecyclePlugin } from "../lifecycle";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { createModules } from "./api";
import { stopDemand } from "./demand/state";
import { stopHost } from "./host/init";
import { stopMonitor } from "./monitor/api";
import { stopSync } from "./sync/views";
import type { Deps, KernelSlice, Modules, RendererCtx, TeardownScope } from "./types";
import { stopViewport } from "./viewport/resize";

/**
 * Resolves the dependency APIs `time`, `lifecycle`, `world`, `clock` and `flow` with
 * `ctx.require`.
 *
 * @param ctx - Kernel context of the renderer plugin.
 * @returns The five dependency APIs.
 */
export function resolveDeps(ctx: KernelSlice): Deps {
  return {
    time: ctx.require(timePlugin),
    lifecycle: ctx.require(lifecyclePlugin),
    world: ctx.require(worldPlugin),
    clock: ctx.require(clockPlugin),
    flow: ctx.require(flowPlugin)
  };
}

/**
 * Builds the domain context the three modules share.
 *
 * @param ctx - Kernel context of the renderer plugin.
 * @returns The domain context of the renderer plugin.
 */
export function withDeps(ctx: KernelSlice): RendererCtx {
  return { ...ctx, deps: resolveDeps(ctx) };
}

/**
 * The draw callback of the renderer: a pending resize is applied first (a pending resolution
 * takes the same path: the backing store changes, the frame and the scale do not), then `demand`
 * decides whether the frame is drawn, the frame is drawn or skipped, `demand` settles it (the dev
 * check, the pixel oracle), and `monitor` closes the frame and hands a drawn one to a waiting
 * capture. The display objects are written by the `sync` system.
 *
 * With `onDemand`, a frame in which nothing visible changed is not drawn: the canvas keeps the
 * last picture (WebGPU presents a canvas texture only when one is rendered; a WebGL canvas keeps
 * what it composited until the next draw).
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param modules - The five modules.
 */
function renderFrame(ctx: RendererCtx, modules: Modules): void {
  if (modules.host.resolutionPending()) ctx.state.viewport.resizePending = true;

  if (modules.viewport.applyPending()) {
    const root = modules.sync.root();

    modules.monitor.changed("resize");

    if (root !== undefined) modules.viewport.apply(root);
    // The browser emptied the canvas when it took its new size: the frame is drawn.
    modules.demand.whole("resize");
  }

  const drawn = modules.demand.decide(modules.monitor.waiting());

  if (drawn) modules.host.render();
  modules.demand.settle(drawn);
  modules.monitor.end(modules.demand.frame().drawn);
}

/**
 * Starts the renderer: host init, then `viewport`, `sync` and the frame callbacks in the
 * `onReady` callback, so nothing is created on a device that cannot draw, and last the monitor
 * of an agent build attaches to the application. A restore rebuilds the tree and attaches the
 * monitor to the new application instead.
 *
 * Inert without a document or without a mount: nothing is created and nothing is registered.
 *
 * @param ctx - Kernel context of the renderer plugin.
 * @returns Resolves when the application is up, or when the plugin stayed inert.
 */
export async function startRenderer(ctx: KernelSlice): Promise<void> {
  const rendererCtx = withDeps(ctx);
  const modules = createModules(rendererCtx);

  // A resolution applied by a frame or a restore empties the canvas: the frame is drawn.
  modules.host.onResolution(() => modules.demand.whole("resize"));

  modules.host.onReady(() => {
    modules.viewport.start();
    modules.sync.start();
    rendererCtx.state.host.cleanups.push(
      rendererCtx.deps.time.onFrame("input", () => modules.monitor.begin()),
      rendererCtx.deps.time.onFrame("render", () => renderFrame(rendererCtx, modules))
    );
    modules.monitor.attach();
  });

  modules.host.onLoss(() => modules.sync.forget());

  modules.host.onRestore(() => {
    // The new canvas starts at Pixi's own size: measure the mount again before the next frame.
    rendererCtx.state.viewport.resizePending = true;
    modules.demand.whole("restore");
    modules.sync.rebuildAll();
    modules.monitor.attach();
  });

  await modules.host.init();
}

/**
 * Stops the renderer in the reverse order of the start: `monitor` answers the waiting captures
 * and stops its performance monitor, `demand` forgets its marks and pictures,
 * `sync` lets its views go while `world` is still alive, `viewport` drops its observer and its
 * probe, and `host` destroys the application. Textures are left to `assets`; a `Display` object
 * is left to the game.
 *
 * @param scope - What `onStop` receives: the frozen config and the plugin state.
 */
export function stopRenderer(scope: TeardownScope): void {
  stopMonitor(scope.state.monitor);
  // After the monitor, so a captured or verified frame never outlives the app.
  stopDemand(scope.state.demand);
  stopSync(scope.state.sync);
  stopViewport(scope.state.viewport);
  stopHost(scope.state.host);
}
