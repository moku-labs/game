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
import { stopKept } from "./kept/state";
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
 * takes the same path: the backing store changes, the frame and the scale do not), then the
 * overlay step (spec 22), then `kept` reads the marks before `demand` decides whether the frame is
 * drawn and clears them; a drawn frame draws the probes of the warm-up onto the canvas first (F4: the
 * stage pass clears them, in the same task, so they never show), then uploads the queued texture sources (F60), then
 * pre-draws the held views of a scene build in pieces (F61), then the kept pictures
 * (`kept.flush`, so the canvas stays one pass, E7), then the stage, then the pixel leg of the kept
 * oracle; `demand` settles the
 * frame (the dev check, the pixel oracle), and `monitor` closes it and hands a drawn one to a
 * waiting capture; last, `host` trims Pixi's texture pool when a rest or a scene change is due. The display objects
 * are written by the `sync` system. While the overdraw heat map of a dev or debug build is on, every frame asks to be
 * drawn and its stage pass is drawn as the map (`sync.drawOverdraw`).
 *
 * With `onDemand`, a frame in which nothing visible changed is not drawn: the canvas keeps the
 * last picture (WebGPU presents a canvas texture only when one is rendered; a WebGL canvas keeps
 * what it composited until the next draw). A drawn frame is reported to `time` for the adaptive
 * frame rate, and only when Pixi drew it: an inert or lost host reports none. A frame that also drew
 * probes, uploaded sources or built the next scene is reported as probed: it did load work, so it is never a sample
 * of the rate.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param modules - The six modules.
 */
function renderFrame(ctx: RendererCtx, modules: Modules): void {
  if (modules.host.resolutionPending()) ctx.state.viewport.resizePending = true;

  if (modules.viewport.applyPending()) {
    const root = modules.sync.root();

    modules.monitor.changed("resize");
    // A new screen and root transform: the walks of `shown` (which leaf is off the screen) are taken again (E4).
    ctx.state.sync.passesVersion += 1;

    if (root !== undefined) modules.viewport.apply(root);
    // The browser emptied the canvas when it took its new size: the frame is drawn.
    modules.demand.whole("resize");
  }

  // A filter switched on or off this frame reaches Pixi before the overlays, the kept cache and the decision read it.
  modules.sync.stepFilters();
  modules.sync.stepOverlays();
  modules.sync.drainOverlayEvents(modules.monitor);
  // Before the decision clears the marks: they become the dirty flags of the pictures.
  modules.kept.collect();

  // The heat map shows every frame as drawn: a still screen too.
  const overdraw = modules.sync.overdrawing();

  if (overdraw) modules.demand.request();

  const drawn = modules.demand.decide(modules.monitor.waiting());

  if (drawn) {
    // F4: probes drawn onto the canvas, then wiped by the stage pass below; never a pixel on screen.
    const probed = modules.sync.warmStep();

    // F60: the queued texture sources go to the GPU, `renderer.uploads` of them, before the frame that shows them.
    const uploaded = modules.sync.uploadStep();

    // F61: the held views of a scene build are drawn in pieces into a texture of their own, before the swap needs them.
    const built = modules.sync.predrawStep();

    // The pictures before the stage pass: every render a picture needs is done when the canvas is drawn.
    modules.kept.flush();

    const rendered = overdraw
      ? modules.sync.drawOverdraw(modules.host.render)
      : modules.host.render();

    if (rendered) {
      ctx.deps.time.frameDrawn();
      // A frame of probes, uploads or building work is load work, no sample of the adaptive rate.
      if (probed || uploaded || built) ctx.deps.time.frameProbed();
    }

    modules.kept.after();
  }

  modules.demand.settle(drawn);

  const settled = modules.demand.frame().drawn;

  modules.monitor.end(settled);
  // Last: Pixi submitted the frame, so the idle render targets of its pool may go (C14).
  modules.host.afterFrame(settled);
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
    modules.monitor.attachPasses();
  });

  modules.host.onLoss(() => modules.sync.forget());

  modules.host.onRestore(rebuilt => {
    // The canvas and every kept picture came back empty: the next frame is drawn whole and takes them again.
    modules.demand.whole("restore");

    // A WebGL context came back on the same application: its tree, its canvas and its monitor stand.
    if (!rebuilt) return;

    // The new canvas starts at Pixi's own size: measure the mount again before the next frame.
    rendererCtx.state.viewport.resizePending = true;
    modules.sync.rebuildAll();
    modules.monitor.attach();
    modules.monitor.attachPasses();
  });

  await modules.host.init();
}

/**
 * Stops the renderer in the reverse order of the start: `monitor` answers the waiting captures
 * and stops its performance monitor, `demand` forgets its marks and pictures, `kept` destroys its
 * textures, `sync` lets its views go while `world` is still alive, `viewport` drops its observer and its
 * probe, and `host` destroys the application. Textures are left to `assets`; a `Display` object
 * is left to the game.
 *
 * @param scope - What `onStop` receives: the frozen config and the plugin state.
 */
export function stopRenderer(scope: TeardownScope): void {
  stopMonitor(scope.state.monitor);
  // After the monitor, so a captured or verified frame never outlives the app.
  stopDemand(scope.state.demand);
  // Every kept texture is destroyed while the application exists, before the views let go.
  stopKept(scope.state.kept);
  stopSync(scope.state.sync);
  stopViewport(scope.state.viewport);
  stopHost(scope.state.host);
}
