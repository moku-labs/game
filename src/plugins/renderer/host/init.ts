/**
 * @file renderer/host — the init sequence: resolve the mount, load Pixi, create the one
 * application, append its canvas. And the teardown that undoes exactly that.
 */
import type { RendererCtx } from "../types";
import type { HostState } from "./types";

/**
 * The device pixel ratio, or 1 where there is none.
 *
 * @returns The ratio the renderer resolution is capped against.
 */
function devicePixels(): number {
  return typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1;
}

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
 * Loads Pixi once, creates the application and appends its canvas. Pixi picks WebGL by itself
 * when WebGPU is missing, so only a device with neither ends up in the catch of the caller.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param mount - Where the canvas goes.
 * @returns Resolves when the canvas is in the page.
 */
export async function createApplication(ctx: RendererCtx, mount: HTMLElement): Promise<void> {
  const state = ctx.state.host;
  const pixi = state.pixi ?? (await ctx.config.loadPixi());

  state.pixi = pixi;

  const app = new pixi.Application();

  await app.init({
    preference: ctx.config.preference,
    background: ctx.config.background,
    antialias: ctx.config.antialias,
    resolution: Math.min(devicePixels(), ctx.config.maxResolution),
    autoDensity: true,
    autoStart: false,
    sharedTicker: false
  });

  state.app = app;
  state.canvas = app.canvas;
  state.mount = mount;
  state.kind = app.renderer.name === "webgpu" ? "webgpu" : "webgl";
  mount.append(app.canvas);
}

/**
 * Destroys the application and its canvas, and forgets both. The textures are left alone: they
 * belong to `assets`.
 *
 * @param state - The host branch of the plugin state.
 */
export function destroyApplication(state: HostState): void {
  const app = state.app;

  state.app = undefined;
  state.canvas = undefined;

  app?.destroy({ removeView: true }, { children: true, texture: false });
}

/**
 * Undoes everything `init` created. Works on the state alone, because `onStop` has no context.
 * `ready` drops first, so a device that goes away during the teardown is ignored.
 *
 * @param state - The host branch of the plugin state.
 */
export function stopHost(state: HostState): void {
  state.ready = false;
  state.restoring = false;

  for (const off of state.cleanups) off();
  state.cleanups.length = 0;

  destroyApplication(state);

  state.unsupported?.remove();
  state.unsupported = undefined;
  state.onReady.length = 0;
  state.onRestore.length = 0;
  state.onLoss.length = 0;
  state.kind = "none";
  state.mount = undefined;
  state.pixi = undefined;
}
