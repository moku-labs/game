/**
 * @file renderer plugin — lifecycle functions: dependency resolution, the `onStart` sequence
 * host → viewport → sync, and the teardown that undoes exactly what it created.
 */
import { lifecyclePlugin } from "../lifecycle";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { createModules } from "./api";
import { stopHost } from "./host/init";
import { stopSync } from "./sync/views";
import type { Deps, KernelSlice, Modules, RendererCtx, TeardownScope } from "./types";
import { stopViewport } from "./viewport/resize";

/**
 * Resolves the dependency APIs `time`, `lifecycle` and `world` with `ctx.require`.
 *
 * @param ctx - Kernel context of the renderer plugin.
 * @returns The three dependency APIs.
 */
export function resolveDeps(ctx: KernelSlice): Deps {
  return {
    time: ctx.require(timePlugin),
    lifecycle: ctx.require(lifecyclePlugin),
    world: ctx.require(worldPlugin)
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
 * The one frame callback of the renderer: a pending resize is applied first, then the frame is
 * drawn. Nothing else happens per frame; the display objects are written by the `sync` system.
 *
 * @param modules - The three modules.
 */
function renderFrame(modules: Modules): void {
  if (modules.viewport.applyPending()) {
    const root = modules.sync.root();

    if (root !== undefined) modules.viewport.apply(root);
  }

  modules.host.render();
}

/**
 * Starts the renderer: host init, then `viewport` and `sync` in the `onReady` callback, so
 * nothing is created on a device that cannot draw. A restore rebuilds the tree instead.
 *
 * Inert without a document or without a mount: nothing is created and nothing is registered.
 *
 * @param ctx - Kernel context of the renderer plugin.
 * @returns Resolves when the application is up, or when the plugin stayed inert.
 */
export async function startRenderer(ctx: KernelSlice): Promise<void> {
  const rendererCtx = withDeps(ctx);
  const modules = createModules(rendererCtx);

  modules.host.onReady(() => {
    modules.viewport.start();
    modules.sync.start();
    rendererCtx.state.host.cleanups.push(
      rendererCtx.deps.time.onFrame("render", () => renderFrame(modules))
    );
  });

  modules.host.onLoss(() => modules.sync.forget());

  modules.host.onRestore(() => {
    // The new canvas starts at Pixi's own size: measure the mount again before the next frame.
    rendererCtx.state.viewport.resizePending = true;
    modules.sync.rebuildAll();
  });

  await modules.host.init();
}

/**
 * Stops the renderer in the reverse order of the start: `sync` lets its views go while `world`
 * is still alive, `viewport` drops its observer and its probe, and `host` destroys the
 * application. Textures are left to `assets`; a `Display` object is left to the game.
 *
 * @param scope - What `onStop` receives: the frozen config and the plugin state.
 */
export function stopRenderer(scope: TeardownScope): void {
  stopSync(scope.state.sync);
  stopViewport(scope.state.viewport);
  stopHost(scope.state.host);
}
