/**
 * @file renderer/host — API factory. The module keeps its data in `ctx.state.host`; nothing
 * above it ever touches Pixi's `Application`.
 */
import type { HostModule, PixiContainer, PixiModule, RendererCtx, RendererKind } from "../types";
import { liveDevice, liveGl, watchDevice } from "./device";
import { createApplication, destroyApplication, resolveMount } from "./init";
import { extractStage, textureUsage } from "./readback";
import {
  askResolution,
  type ResolutionReason,
  refreshResolution,
  resizeAt,
  targetResolution,
  watchPixelRatio
} from "./resolution";
import type { HostDeps, ResolutionListener, TextureUsage } from "./types";
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
      await createApplication(ctx, mount, deps.installCounting);
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

    onRestore: (fn: () => void): void => {
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

    setResolution: (value: number, reason: ResolutionReason): boolean =>
      askResolution(state, value, reason),

    overrideResolution: (value: number | undefined): number => {
      state.resolution.override = value;
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

    resolution: (): number => state.app?.renderer.resolution ?? 1,

    textures: (): TextureUsage => {
      const app = state.app;

      if (!state.ready || app === undefined) {
        return { count: 0, bytes: 0, art: 0, targets: 0, kept: 0 };
      }

      return textureUsage(app, state.kept);
    },

    init: async (): Promise<void> => {
      const mount = resolveMount(ctx);

      if (mount === undefined) return;

      state.mount = mount;

      try {
        await createApplication(ctx, mount, deps.installCounting);
      } catch (error) {
        showUnsupported(ctx, mount, error);

        return;
      }

      watchDevice(ctx, restart);
      watchVisibility(ctx);
      watchPixelRatio(ctx);
      state.ready = true;

      for (const fn of state.onReady) fn();
    }
  };
}
