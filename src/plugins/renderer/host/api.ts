/**
 * @file renderer/host — API factory. The module keeps its data in `ctx.state.host`; nothing
 * above it ever touches Pixi's `Application`.
 */
import type {
  HostModule,
  PixiContainer,
  PixiMatrix,
  PixiModule,
  PixiRenderTexture,
  PixiTextureSource,
  RendererCtx,
  RendererKind
} from "../types";
import { liveDevice, liveGl, watchDevice } from "./device";
import { createApplication, destroyApplication, resolveMount } from "./init";
import { afterFrame, sceneChanged, trimPool } from "./pool";
import { extractStage, readPixels, textureUsage } from "./readback";
import {
  allowRuleScale,
  askResolution,
  type ResolutionReason,
  refreshResolution,
  resizeAt,
  scaleFloorOf,
  targetResolution,
  watchPixelRatio
} from "./resolution";
import type {
  CanvasPassListener,
  HostDeps,
  ResolutionListener,
  TextureUsage,
  TrimListener,
  TrimReason
} from "./types";
import { showUnsupported } from "./unsupported";
import { watchVisibility } from "./visibility";

/**
 * Creates the host module: the one Pixi application and everything that can take it away.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The counting the plugin root injects in a dev or debug build.
 * @returns The host API and its internal half.
 */
export function createHostApi(ctx: RendererCtx, deps: HostDeps): HostModule {
  const state = ctx.state.host;

  /**
   * Builds a new application over the same mount, after the old device went away.
   *
   * @returns True when the new application is up.
   */
  const restart = async (): Promise<boolean> => {
    const mount = state.mount;

    if (mount === undefined) return false;

    // The tree is still alive here: this is where `sync` saves the objects the game owns.
    for (const fn of state.onLoss) fn();

    destroyApplication(state);

    try {
      await createApplication(ctx, mount, deps);
    } catch (error) {
      showUnsupported(ctx, mount, error);

      return false;
    }

    watchDevice(ctx, restart);

    return true;
  };

  return {
    ready: (): boolean => state.ready,
    kind: (): RendererKind => state.kind,
    canvas: (): HTMLCanvasElement | undefined => state.canvas,
    pixi: (): PixiModule | undefined => (state.ready ? state.pixi : undefined),
    device: (): GPUDevice | undefined => liveDevice(state),
    gl: (): WebGL2RenderingContext | undefined => liveGl(state),
    stage: (): PixiContainer | undefined => state.app?.stage,
    mount: (): HTMLElement | undefined => state.mount,

    onReady: (fn: () => void): void => {
      state.onReady.push(fn);
    },

    onRestore: (fn: (rebuilt: boolean) => void): void => {
      state.onRestore.push(fn);
    },

    onLoss: (fn: () => void): void => {
      state.onLoss.push(fn);
    },

    resize: (width: number, height: number): void => resizeAt(state, width, height),

    render: (): boolean => {
      const app = state.app;

      if (!state.ready || app === undefined) return false;

      app.renderer.render(app.stage);

      return true;
    },

    renderTo: (
      container: PixiContainer,
      target: PixiRenderTexture,
      transform: PixiMatrix,
      clear: boolean
    ): boolean => {
      const app = state.app;

      if (!state.ready || app === undefined) return false;

      // A fresh colour each call: Pixi keeps the options of the render for its runners.
      app.renderer.render({ container, target, transform, clear, clearColor: [0, 0, 0, 0] });

      return true;
    },

    renderProbe: (container: PixiContainer, target?: PixiRenderTexture): boolean => {
      const app = state.app;

      if (!state.ready || app === undefined) return false;

      if (target === undefined) app.renderer.render({ container, clear: false });
      else app.renderer.render({ container, target, clear: true });

      return true;
    },

    initSource: (source: PixiTextureSource): void => {
      const app = state.app;

      if (!state.ready || app === undefined) return;

      app.renderer.texture.initSource(source);
    },

    clearsCanvas: (): boolean =>
      state.ready && state.app?.renderer.background.clearBeforeRender === true,

    setResolution: (value: number, reason: ResolutionReason): boolean =>
      askResolution(state, value, reason),

    overrideResolution: (value: number | undefined): number => {
      state.resolution.override = value;
      // A player's resolution wins: the adaptive frame rate gets no scale while it holds.
      allowRuleScale(ctx);
      refreshResolution(ctx, "debug");

      return targetResolution(state.resolution);
    },

    resolutionPending: (): boolean => state.resolution.pending !== undefined,

    onResolution: (fn: ResolutionListener): void => {
      state.onResolutionChange.push(fn);
    },

    adapter: (): GPUAdapter | undefined => (state.ready ? state.ownGpu?.adapter : undefined),

    keep: (source: object, on: boolean): void => {
      if (on) state.kept.add(source);
      else state.kept.delete(source);
    },

    extract: async (hidden: readonly PixiContainer[]): Promise<string | undefined> => {
      const app = state.app;

      if (!state.ready || app === undefined) return undefined;

      return extractStage(ctx, app, hidden);
    },

    resolution: (): number => {
      const app = state.app;

      // No `?.` and `??`: they merge the number with `undefined`, which boxes a fractional one every frame.
      return app === undefined ? 1 : app.renderer.resolution;
    },

    textures: (): TextureUsage => {
      const app = state.app;

      if (!state.ready || app === undefined) {
        return { count: 0, bytes: 0, art: 0, targets: 0, kept: 0 };
      }

      return textureUsage(app, state.kept);
    },

    pixels: (resolution?: number): Uint8ClampedArray | undefined => {
      const app = state.app;

      if (!state.ready || app === undefined) return undefined;

      return readPixels(ctx, app, resolution);
    },

    screen: (): { x: number; y: number; width: number; height: number } | undefined => {
      const app = state.app;

      return state.ready && app !== undefined ? app.screen : undefined;
    },

    afterFrame: (drawn: boolean): void => afterFrame(ctx, drawn),

    sceneChanged: (): void => sceneChanged(ctx),

    trimPool: (reason: TrimReason): number => trimPool(ctx, reason),

    onTrim: (fn: TrimListener): void => {
      state.onTrim.push(fn);
    },

    onCanvasPass: (fn: CanvasPassListener): void => {
      state.onCanvasPass = fn;
    },

    init: async (): Promise<void> => {
      const mount = resolveMount(ctx);

      if (mount === undefined) return;

      state.mount = mount;

      try {
        await createApplication(ctx, mount, deps);
      } catch (error) {
        showUnsupported(ctx, mount, error);

        return;
      }

      watchDevice(ctx, restart);
      watchVisibility(ctx);
      watchPixelRatio(ctx);
      state.resolution.floor = scaleFloorOf(ctx.config);
      allowRuleScale(ctx);
      state.ready = true;

      for (const fn of state.onReady) fn();
    }
  };
}
