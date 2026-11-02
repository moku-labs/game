/**
 * @file renderer/host — the init sequence: resolve the mount, load Pixi, create the one
 * application, append its canvas. And the teardown that undoes exactly that.
 */
import type { RegisteredFeature } from "../../flow/types";
import type { PixiModule, RendererCtx } from "../types";
import { initTimed, startupMark } from "./gpu";
import { installRebindingRenderGroupPipe } from "./render-group";
import { installLazyCanvasPass } from "./render-pass";
import { devicePixels, targetResolution } from "./resolution";
import { installSdfText } from "./sdf-text";
import { createPoolState } from "./state";
import type { HostDeps, HostState, InstallCounting } from "./types";

/**
 * Finds the element the canvas goes into. A missing document or a missing `mount` keeps the
 * plugin inert and says why; a selector that matches nothing is a mistake and throws.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @returns The mount element, or `undefined` when the renderer stays inert.
 * @throws {Error} When `config.mount` is a selector that matches no element.
 */
export function resolveMount(ctx: RendererCtx): HTMLElement | undefined {
  if (typeof globalThis.document === "undefined") {
    ctx.log.debug("renderer: no document, staying inert");

    return undefined;
  }

  const mount = ctx.config.mount;

  if (mount === undefined) {
    ctx.log.warn("renderer: no mount, staying inert");

    return undefined;
  }

  if (typeof mount !== "string") return mount;

  const found: HTMLElement | null | undefined =
    globalThis.document.querySelector<HTMLElement>(mount);

  if (found === null || found === undefined) {
    throw new Error(
      `[game] renderer.mount "${mount}" matches no element.\n` +
        '  Add <div id="game"></div> to the page or pass the element.'
    );
  }

  return found;
}

/**
 * Installs the pass counting of a production build (F8): the encoder alone, swapped once per host
 * state, so `stats().renderPasses` is measured on the GPU path in every build. A Pixi without the
 * encoder draws on with the estimate, with a warning.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param pixi - The module the application is built from.
 * @param install - The pass counting the plugin root injected.
 */
function installPasses(ctx: RendererCtx, pixi: PixiModule, install: InstallCounting): void {
  const state = ctx.state.host;

  if (state.uninstallPasses !== undefined) return;

  try {
    state.uninstallPasses = install(pixi);
  } catch (error) {
    ctx.log.warn("renderer: passes are not counted", { error });
  }
}

/**
 * Swaps Pixi's six counting bases for counting subclasses, so `stats().drawCalls` sees every draw
 * and the monitor of a debug build every pass, filter apply and upload; any other build swaps the
 * encoder alone, for the pass count (F8). It runs before `new Application()`, because Pixi builds
 * its systems and adaptors inside `init`. Once per host state: a restore reuses the installed
 * classes. The two branches are an if/else written positive behind the inline dev or agent guard,
 * so each build keeps one of them and a production `define` drops the log marker. A Pixi without
 * these classes draws on uncounted, with a warning.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param pixi - The module the application is built from.
 * @param deps - The counting the plugin root injected: `installCounting` is `undefined` in a production build.
 */
function installCounting(ctx: RendererCtx, pixi: PixiModule, deps: HostDeps): void {
  const state = ctx.state.host;
  const install = deps.installCounting;

  // The dev or agent guard of `capture()`, written as a positive branch: Bun 1.3.14 drops code
  // used only inside a folded `if`, but keeps code used after a folded early `return`.
  if (
    (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
    (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
  ) {
    // A counter was injected and none is installed yet.
    if (install !== undefined && state.uninstallCounting === undefined) {
      ctx.log.debug("moku:dev", { command: "renderer.monitor" });

      try {
        state.uninstallCounting = install(pixi);
      } catch (error) {
        ctx.log.warn("renderer: frames are not counted", { error });
      }
    }
  } else {
    installPasses(ctx, pixi, deps.installPasses);
  }
}

/**
 * Installs the renderer's batched distance-field text: its batcher, its bitmap text pipe and its batch pipe, which draw
 * consecutive labels in one draw with the alpha applied once. It runs before `new Application()`, because Pixi builds
 * its pipes inside `init`, and before the draw counter, whose batch pipe extends the routing one and takes its place;
 * once per host state: a restore reuses the installed pieces. Every build installs it. A Pixi without the pieces draws
 * on with its own pipes, with a warning.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param pixi - The module the application is built from.
 */
function installTextBatch(ctx: RendererCtx, pixi: PixiModule): void {
  const state = ctx.state.host;

  if (state.uninstallSdfText !== undefined) return;

  try {
    state.uninstallSdfText = installSdfText(pixi);
  } catch (error) {
    ctx.log.warn("renderer: distance-field text applies its alpha twice", { error });
  }
}

/**
 * Swaps Pixi's render-group pipe for the renderer's, which binds a filter's input again after a group cached as a
 * texture was refreshed inside the filter (F10). Like the batched text it runs before `new Application()`, once per
 * host state, in every build. A Pixi without the pieces draws on with its own pipe, with a warning.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param pixi - The module the application is built from.
 */
function installRenderGroup(ctx: RendererCtx, pixi: PixiModule): void {
  const state = ctx.state.host;

  if (state.uninstallRenderGroup !== undefined) return;

  try {
    state.uninstallRenderGroup = installRebindingRenderGroupPipe(pixi);
  } catch (error) {
    ctx.log.warn("renderer: a cached group inside a filter may draw to the canvas", { error });
  }
}

/**
 * Swaps Pixi's WebGPU render target and pipeline systems for the renderer's, which begin the canvas's render pass at
 * its first draw and keep the canvas's stencil and depth only where something reads them (B3). Like the batched text it
 * runs before `new Application()`, once per host state, in every build. A Pixi without the pieces draws on with its own
 * systems, with a warning.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param pixi - The module the application is built from.
 */
function installRenderPass(ctx: RendererCtx, pixi: PixiModule): void {
  const state = ctx.state.host;

  if (state.uninstallRenderPass !== undefined) return;

  try {
    state.uninstallRenderPass = installLazyCanvasPass(pixi, restart => {
      state.onCanvasPass?.(restart);
    });
  } catch (error) {
    ctx.log.warn("renderer: the canvas pass begins at render start", { error });
  }
}

/**
 * Tells whether a feature brings a filter that reads what was drawn under its view (`defineFilter({ backdrop: true })`).
 * Pixi's WebGL renderer copies that from its back buffer, and skips such a filter, with a warning, without one; the back
 * buffer costs a full-screen copy per drawn frame, so it is asked for only then. WebGPU copies from the canvas and
 * ignores the option.
 *
 * @param features - Every feature of the game, its sub-features included.
 * @returns True when one of their filters is a backdrop.
 */
function wantsBackBuffer(features: readonly RegisteredFeature[]): boolean {
  for (const feature of features) {
    for (const entry of feature.description.filters ?? []) {
      if ("backdrop" in entry.filter && entry.filter.backdrop === true) return true;
    }
  }

  return false;
}

/**
 * Loads Pixi once, creates the application and appends its canvas, at the target resolution of
 * now: a restore after a lost device comes back at it, override included. Pixi picks WebGL by
 * itself when WebGPU is missing, so only a device with neither ends up in the catch of the
 * caller. An agent build marks the Pixi load and the init on the page's timeline and hands Pixi
 * the engine's own device. A game with a backdrop filter gets Pixi's WebGL back buffer.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param mount - Where the canvas goes.
 * @param deps - The counting of a dev or debug build and the pass counting of the others.
 * @returns Resolves when the canvas is in the page.
 */
export async function createApplication(
  ctx: RendererCtx,
  mount: HTMLElement,
  deps: HostDeps
): Promise<void> {
  const state = ctx.state.host;
  const loaded = state.pixi;

  // Inline and positive: Bun folds the agent guard under a production `define`.
  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && loaded === undefined) {
    startupMark("moku:pixi-start");
  }

  const pixi = loaded ?? (await ctx.config.loadPixi());

  if (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__ && loaded === undefined) {
    startupMark("moku:pixi-end");
  }

  state.pixi = pixi;
  installTextBatch(ctx, pixi);
  installCounting(ctx, pixi, deps);
  installRenderGroup(ctx, pixi);
  installRenderPass(ctx, pixi);

  state.resolution.dpr = devicePixels();
  state.resolution.cap = ctx.config.maxResolution;
  state.resolution.pending = undefined;

  const app = new pixi.Application();
  const options = {
    preference: ctx.config.preference,
    background: ctx.config.background,
    antialias: ctx.config.antialias,
    resolution: targetResolution(state.resolution),
    // The host sets the canvas box itself (`resizeAt`): Pixi's would be the rounded-up store, past the mount.
    autoDensity: false,
    autoStart: false,
    sharedTicker: false,
    useBackBuffer: wantsBackBuffer(ctx.deps.flow.features.all()),
    // `input` hit-tests every pointer sample itself (`sync.hitTest`) and owns the cursor, `touch-action` and
    // `preventDefault`; nothing listens to a Pixi event. Pixi's own handling would hit-test the tree again (F118).
    eventMode: "none",
    eventFeatures: { move: false, globalMove: false, click: false, wheel: false }
  } as const;

  // Inline and positive: a production `define` folds the condition to `app.init(options)`.
  await (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__
    ? initTimed(ctx, app, options)
    : app.init(options));

  state.app = app;
  state.canvas = app.canvas;
  state.mount = mount;
  state.kind = app.renderer.name === "webgpu" ? "webgpu" : "webgl";
  // A canvas is inline by default and leaves a line gap under it: the page grows past the window
  // and scrolls. Block layout keeps it exactly the size of its mount.
  app.canvas.style.display = "block";
  // Until its first layout gives it the measured size, a canvas made again after a lost device fills its mount:
  // with no size of its own it would show at its backing store's size.
  app.canvas.style.width = "100%";
  app.canvas.style.height = "100%";
  mount.append(app.canvas);
}

/**
 * Destroys the application and its canvas, and forgets both, then the engine's own device of an
 * agent build: Pixi leaves a device it was handed alone. The textures are left alone: they belong
 * to `assets`.
 *
 * @param state - The host branch of the plugin state.
 */
export function destroyApplication(state: HostState): void {
  const app = state.app;
  const gpu = state.ownGpu;

  state.app = undefined;
  state.canvas = undefined;
  state.ownGpu = undefined;

  app?.destroy({ removeView: true }, { children: true, texture: false });
  gpu?.device.destroy();
}

/**
 * Undoes everything `init` created. Works on the state alone, because `onStop` has no context.
 * `ready` drops first, so a device that goes away during the teardown is ignored. The draw
 * counter, the batched text, the render-group pipe and the lazy canvas pass swap Pixi's own classes back, so the next
 * application on the page starts from them. The pool trim starts over and its listeners go; Pixi's pool itself is left.
 *
 * @param state - The host branch of the plugin state.
 */
export function stopHost(state: HostState): void {
  state.ready = false;
  state.restoring = false;

  for (const off of state.cleanups) off();
  state.cleanups.length = 0;

  destroyApplication(state);

  state.uninstallCounting?.();
  state.uninstallCounting = undefined;
  state.uninstallPasses?.();
  state.uninstallPasses = undefined;
  state.uninstallSdfText?.();
  state.uninstallSdfText = undefined;
  state.uninstallRenderGroup?.();
  state.uninstallRenderGroup = undefined;
  state.uninstallRenderPass?.();
  state.uninstallRenderPass = undefined;
  state.unsupported?.remove();
  state.unsupported = undefined;
  state.onReady.length = 0;
  state.onRestore.length = 0;
  state.onLoss.length = 0;
  state.onResolutionChange.length = 0;
  state.onTrim.length = 0;
  state.onCanvasPass = undefined;
  // The pool is module-global and another app on the page may draw: it is not cleared here.
  state.pool = createPoolState();
  state.resolution.pending = undefined;
  state.kind = "none";
  state.mount = undefined;
  state.pixi = undefined;
}
