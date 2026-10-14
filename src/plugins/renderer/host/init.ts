/**
 * @file renderer/host — the init sequence: resolve the mount, load Pixi, create the one
 * application, append its canvas. And the teardown that undoes exactly that.
 */
import type { PixiModule, RendererCtx } from "../types";
import { initTimed, startupMark } from "./gpu";
import { devicePixels, targetResolution } from "./resolution";
import { installSdfTextPipe } from "./sdf-text";
import type { HostState, InstallCounting } from "./types";

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
 * Swaps Pixi's six counting bases for counting subclasses, so `stats().drawCalls` sees every draw
 * and the monitor of a debug build every pass, filter apply and upload. It runs before
 * `new Application()`, because Pixi builds its systems and adaptors inside `init`. Once per host
 * state: a restore reuses the installed classes. Dev and debug builds only, behind the inline dev
 * or agent guard, so a production `define` folds it and its log marker leaves the bundle.
 * A Pixi without these classes draws on uncounted, with a warning.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param pixi - The module the application is built from.
 * @param install - The counting the plugin root injected, `undefined` in a production build.
 */
function installCounting(
  ctx: RendererCtx,
  pixi: PixiModule,
  install: InstallCounting | undefined
): void {
  const state = ctx.state.host;
  // A counter was injected and none is installed yet.
  const canInstall = install !== undefined && state.uninstallCounting === undefined;

  // The dev or agent guard of `capture()`, written as a positive branch: Bun 1.3.14 drops code
  // used only inside a folded `if`, but keeps code used after a folded early `return`.
  if (
    ((typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
      (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)) &&
    canInstall
  ) {
    ctx.log.debug("moku:dev", { command: "renderer.monitor" });

    try {
      state.uninstallCounting = install(pixi);
    } catch (error) {
      ctx.log.warn("renderer: frames are not counted", { error });
    }
  }
}

/**
 * Swaps Pixi's bitmap text pipe for the renderer's, whose SDF shader applies the alpha of
 * distance-field text once. Like the draw counter it runs before `new Application()`, because Pixi
 * builds its pipes inside `init`, and once per host state: a restore reuses the installed pipe.
 * Every build installs it. A Pixi without the pieces draws on with its own pipe, with a warning.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param pixi - The module the application is built from.
 */
function installSdfText(ctx: RendererCtx, pixi: PixiModule): void {
  const state = ctx.state.host;

  if (state.uninstallSdfText !== undefined) return;

  try {
    state.uninstallSdfText = installSdfTextPipe(pixi);
  } catch (error) {
    ctx.log.warn("renderer: distance-field text applies its alpha twice", { error });
  }
}

/**
 * Loads Pixi once, creates the application and appends its canvas, at the target resolution of
 * now: a restore after a lost device comes back at it, override included. Pixi picks WebGL by
 * itself when WebGPU is missing, so only a device with neither ends up in the catch of the
 * caller. An agent build marks the Pixi load and the init on the page's timeline and hands Pixi
 * the engine's own device.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param mount - Where the canvas goes.
 * @param install - The counting of a dev or debug build, `undefined` in production.
 * @returns Resolves when the canvas is in the page.
 */
export async function createApplication(
  ctx: RendererCtx,
  mount: HTMLElement,
  install: InstallCounting | undefined
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
  installCounting(ctx, pixi, install);
  installSdfText(ctx, pixi);

  state.resolution.dpr = devicePixels();
  state.resolution.cap = ctx.config.maxResolution;
  state.resolution.pending = undefined;

  const app = new pixi.Application();
  const options = {
    preference: ctx.config.preference,
    background: ctx.config.background,
    antialias: ctx.config.antialias,
    resolution: targetResolution(state.resolution),
    autoDensity: true,
    autoStart: false,
    sharedTicker: false
  };

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
 * counter and the bitmap text pipe swap Pixi's own classes back, so the next application on the
 * page starts from them.
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
  state.uninstallSdfText?.();
  state.uninstallSdfText = undefined;
  state.unsupported?.remove();
  state.unsupported = undefined;
  state.onReady.length = 0;
  state.onRestore.length = 0;
  state.onLoss.length = 0;
  state.onResolutionChange.length = 0;
  state.resolution.pending = undefined;
  state.kind = "none";
  state.mount = undefined;
  state.pixi = undefined;
}
